import hkdf from "https://deno.land/x/hkdf@v1.0.2/index.ts";

import { encrypt } from "./encode.ts";
import { decrypt } from "./decode.ts";
import { base64url } from "../../deps.ts";

const NONCE_SIZE = 12;
const SHA_256_SIZE = 32;

export const RS_SIZE = 4;
export const PAD_SIZE = 1;
export const KEY_SIZE = 16;
export const SALT_SIZE = 16;
export const ID_LEN_SIZE = 1;

export const decode = (b: string | Uint8Array) =>
  typeof b === "string" ? base64url.decode(b) : b;

export const webpushSecret = async (
  authSecret: Uint8Array,
  privateKey: CryptoKey,
  keys: {
    remotePubKey: Uint8Array;
    receiverPubKey: Uint8Array;
    senderPubKey: Uint8Array;
  },
) => {
  const deriveKey = await crypto.subtle.importKey(
    "raw",
    keys.remotePubKey,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  ).then((remotePublicKey) =>
    crypto.subtle.deriveKey(
      { name: "ECDH", public: remotePublicKey },
      privateKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    )
  ).then((key) => crypto.subtle.exportKey("raw", key))
    .then((key) => new Uint8Array(key));

  const infoPrefix = new TextEncoder().encode("WebPush: info\0");
  const info = new Uint8Array(
    infoPrefix.length + keys.receiverPubKey.length + keys.senderPubKey.length,
  );
  info.set(infoPrefix);
  info.set(keys.receiverPubKey, infoPrefix.length);
  info.set(keys.senderPubKey, infoPrefix.length + keys.receiverPubKey.length);

  return await hkdf("sha256", deriveKey, authSecret, info, SHA_256_SIZE);
};

export interface KeyAndNonce {
  key: Uint8Array;
  nonce: Uint8Array;
}

export const deriveKeyAndNonce = async (
  salt: Uint8Array,
  secret: Uint8Array,
) => {
  const textEncoder = new TextEncoder();
  const keyInfo = textEncoder.encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = textEncoder.encode("Content-Encoding: nonce\0");

  return await Promise.all([
    hkdf("sha256", secret, salt, keyInfo, KEY_SIZE)
      .then((hash) => ({ key: hash })),
    hkdf("sha256", secret, salt, nonceInfo, NONCE_SIZE)
      .then((hash) => ({ nonce: hash })),
  ]).then((ret) => ({ ...ret[0], ...ret[1] }));
};

export const generateNonce = (base: Uint8Array, counter: number) => {
  const nonce = new DataView(base.buffer);
  const m = nonce.getUint32(nonce.byteLength - 4);
  const xor = (m ^ counter) >>> 0;
  nonce.setUint32(nonce.byteLength - 4, xor);
  return nonce.buffer;
};

export default {
  encrypt,
  decrypt,
};
