import { Buffer } from "node:buffer";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, GetAssertion, GetAssertionOptions } from "@wake-protocol/client";

/**
 * ソフトウェアのパスキー。WebCrypto の P-256 鍵で、登録の応答と WAKE のログインの署名を作る。
 * ブラウザの `navigator.credentials` の代わりにテストで使う。
 */

/** `generateRegistrationOptions` が返す JSON のうち、使う欄だけ */
export interface CreationOptions {
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  excludeCredentials?: { id: string; transports?: string[] }[];
}

/** サーバーに送る登録の応答（ebina-front の RegistrationResponseJSON と同じ形） */
export interface RegistrationResponse {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    attestationObject: string;
    authenticatorData: string;
    publicKey: string;
    publicKeyAlgorithm: number;
    transports: string[];
  };
  clientExtensionResults: Record<string, never>;
  authenticatorAttachment: string;
}

export interface SoftCredential {
  id: Uint8Array;
  rpId: string;
  userHandle: Uint8Array;
  privateKey: CryptoKey;
  /** 最後に署名したときのカウンター */
  signCount: number;
}

const encoder = new TextEncoder();

/** isoCBOR.encode が受ける値の型 */
type Cbor = Parameters<typeof isoCBOR.encode>[0];

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromB64url(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(n: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, n, false);
  return out;
}

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

/** DER の INTEGER（正の整数。先頭の 0 を省き、最上位ビットが立つときは 0x00 を足す） */
function derInteger(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  let body: Uint8Array = value.slice(start);
  if (body[0] & 0x80) body = concat(new Uint8Array([0]), body);
  return concat(new Uint8Array([0x02, body.length]), body);
}

/** WebCrypto の ECDSA 署名（r||s の 64 バイト）を、WebAuthn が使う DER の SEQUENCE にする */
export function ecdsaRawToDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error("P-256 の署名は 64 バイトのはずです");
  const body = concat(derInteger(raw.slice(0, 32)), derInteger(raw.slice(32)));
  // 長さは最大でも 70 バイトなので 1 バイトで表せる
  return concat(new Uint8Array([0x30, body.length]), body);
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class SoftAuthenticator {
  readonly origin: string;
  readonly credentials: SoftCredential[] = [];

  /** origin はブラウザが clientDataJSON に入れるもの（例 http://localhost:5173） */
  constructor(origin: string) {
    this.origin = origin;
  }

  /** 登録: `generateRegistrationOptions` の JSON から、サーバーに送る応答を作る。パスキーはこのオブジェクトが持つ */
  async register(
    options: CreationOptions,
    overrides: { credentialId?: Uint8Array } = {},
  ): Promise<RegistrationResponse> {
    const rpId = options.rp.id;
    if (!rpId) throw new Error("rp.id がありません");
    const userHandle = fromB64url(options.user.id);

    // ブラウザと同じく、除外リストにあるパスキーをすでに持っていたら作らない
    for (const excluded of options.excludeCredentials ?? []) {
      const id = fromB64url(excluded.id);
      if (this.credentials.some((c) => c.rpId === rpId && Buffer.compare(c.id, id) === 0)) {
        throw new Error("このパスキーはすでに登録されています");
      }
    }

    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
    const id = overrides.credentialId ?? crypto.getRandomValues(new Uint8Array(16));

    // COSE_Key（EC2、ES256、P-256）
    const cose = isoCBOR.encode(
      new Map<string | number, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, raw.slice(1, 33)],
        [-3, raw.slice(33, 65)],
      ]),
    );
    const authData = concat(
      await sha256(encoder.encode(rpId)),
      new Uint8Array([FLAG_UP | FLAG_UV | FLAG_AT]),
      u32(0),
      new Uint8Array(16), // aaguid
      u16(id.length),
      id,
      cose,
    );
    const attestationObject = isoCBOR.encode(
      new Map<string | number, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map<string | number, Cbor>()],
        ["authData", authData],
      ]),
    );
    const clientDataJSON = encoder.encode(
      JSON.stringify({
        type: "webauthn.create",
        challenge: options.challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );

    this.credentials.push({ id, rpId, userHandle, privateKey: keyPair.privateKey, signCount: 0 });
    return {
      id: b64url(id),
      rawId: b64url(id),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        authenticatorData: b64url(authData),
        publicKey: b64url(spki),
        publicKeyAlgorithm: -7,
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** WakeClient の `getAssertion`。許可リストがあればその中から、空（discoverable）なら rpId の最新のパスキーで署名する */
  readonly getAssertion: GetAssertion = async (options: GetAssertionOptions): Promise<AuthenticationResponseJSON> => {
    const allowed = options.allowCredentials.map((c) => fromB64url(c.id));
    const candidates = this.credentials.filter((c) => c.rpId === options.rpId);
    const credential = allowed.length === 0
      ? candidates.at(-1)
      : candidates.find((c) => allowed.some((id) => Buffer.compare(c.id, id) === 0));
    if (!credential) throw new Error("使えるパスキーがありません");

    credential.signCount += 1;
    const clientDataJSON = encoder.encode(
      JSON.stringify({
        type: "webauthn.get",
        challenge: b64url(options.challenge),
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const authData = concat(
      await sha256(encoder.encode(options.rpId)),
      new Uint8Array([FLAG_UP | FLAG_UV]),
      u32(credential.signCount),
    );
    const signed = concat(authData, await sha256(clientDataJSON));
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, credential.privateKey, signed as BufferSource),
    );
    return {
      id: b64url(credential.id),
      rawId: b64url(credential.id),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(ecdsaRawToDer(raw)),
        userHandle: b64url(credential.userHandle),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  };
}
