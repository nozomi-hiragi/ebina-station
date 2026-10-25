import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { type Context, Hono } from "hono";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { convertCOSEtoPKCS } from "@simplewebauthn/server/helpers";
import type { WakeCredential } from "@wake-protocol/server";
import type { StationConfig } from "../config.ts";
import { BadRequest } from "../http/errors.ts";
import { log } from "../log.ts";
import { CredentialExistsError, type SqliteCredentialStore } from "./credentials.ts";
import type { RegistrationRepo } from "./registrations.ts";
import { UserNotFoundError } from "./users.ts";

export interface RegisterDeps {
  config: StationConfig;
  credentials: SqliteCredentialStore;
  registrations: RegistrationRepo;
}

/** P-256 公開鍵の SPKI DER のうち、点（0x04||x||y）より前の固定部分 */
const P256_SPKI_PREFIX = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");

/** ES256（COSE のアルゴリズム -7）だけを受け付ける */
const ES256 = -7;

const KNOWN_TRANSPORTS = ["usb", "nfc", "ble", "internal", "hybrid", "smart-card", "cable"];

const ERROR_INVALID_TOKEN = "登録トークンが無効か、期限切れです";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequest("JSON が正しくありません");
  }
  if (!isRecord(body)) throw new BadRequest("JSON が正しくありません");
  return body;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 最低限の形だけ確かめる。中身の検証は verifyRegistrationResponse に任せる */
function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  if (!isRecord(value)) return false;
  const { id, rawId, type, response, clientExtensionResults } = value;
  return typeof id === "string" && id !== "" && typeof rawId === "string" && rawId !== "" && type === "public-key" &&
    isRecord(response) && typeof response.clientDataJSON === "string" &&
    typeof response.attestationObject === "string" && isRecord(clientExtensionResults);
}

function readTransports(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const transports = value.filter((t): t is string => typeof t === "string" && KNOWN_TRANSPORTS.includes(t));
  return transports.length > 0 ? transports : undefined;
}

/** `/register/*` を足した Hono を返す（`/ebina` を前に付けてマウントする） */
export function createRegisterRoutes(deps: RegisterDeps): Hono {
  const { config, credentials, registrations } = deps;
  const app = new Hono();

  const invalidToken = (c: Context) => c.json({ error: ERROR_INVALID_TOKEN }, 404);

  app.get("/info", (c) => {
    const reg = registrations.get(c.req.query("token") ?? "");
    if (!reg) return invalidToken(c);
    return c.json({ id: reg.user.id, name: reg.user.name });
  });

  app.post("/options", async (c) => {
    const body = await readBody(c);
    const token = str(body.token);
    const reg = registrations.get(token);
    if (!reg) return invalidToken(c);
    const check = registrations.checkCode(token, str(body.code));
    if (check.status === "invalid") return invalidToken(c);
    if (check.status === "wrong") {
      return c.json({ error: `確認コードが違います（残り ${check.remaining} 回）`, remaining: check.remaining }, 403);
    }
    const { user } = reg;
    const existing = credentials.listByUser(user.id);
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: user.id,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      supportedAlgorithmIDs: [ES256],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      excludeCredentials: existing.map((cred) => ({
        id: Buffer.from(cred.credentialId).toString("base64url"),
        ...(cred.transports ? { transports: cred.transports } : {}),
      })),
    });
    registrations.setChallenge(token, options.challenge);
    return c.json(options);
  });

  app.post("/verify", async (c) => {
    const body = await readBody(c);
    const token = str(body.token);
    const reg = registrations.get(token);
    if (!reg) return invalidToken(c);
    if (!reg.challenge) return c.json({ error: "先に登録を開始してください" }, 400);

    const clientResponse = body.response;
    if (!isRegistrationResponse(clientResponse)) return c.json({ error: "登録情報が不正です" }, 400);

    const publicKeyBase64url = clientResponse.response.publicKey;
    if (typeof publicKeyBase64url !== "string" || !publicKeyBase64url) {
      return c.json({ error: "公開鍵が見つかりません" }, 400);
    }

    // 検証に進んだ登録が失敗したら challenge を捨てる。同じ challenge で何度も試せないようにする
    // （やり直すときは options からもう一度）
    const reject = (message: string, status: 400 | 409 = 400) => {
      registrations.clearChallenge(token);
      return c.json({ error: message }, status);
    };

    let cred: WakeCredential;
    try {
      const result = await verifyRegistrationResponse({
        response: clientResponse,
        expectedChallenge: reg.challenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [ES256],
      });
      if (!result.verified || !result.registrationInfo) return reject("パスキーを検証できませんでした");

      const { registrationInfo } = result;
      // 保存する鍵は検証済みの COSE から作る。クライアントが送った SPKI は一致するかだけを見る
      const point = convertCOSEtoPKCS(registrationInfo.credential.publicKey);
      if (point.length !== 65 || point[0] !== 0x04) return reject("公開鍵の形式が不正です");
      const publicKey = Buffer.concat([P256_SPKI_PREFIX, point]);
      const clientKey = Buffer.from(publicKeyBase64url, "base64url");
      if (clientKey.length !== publicKey.length || !timingSafeEqual(clientKey, publicKey)) {
        return reject("公開鍵が一致しません");
      }

      // 検証済みの ID を使う。既存の ID の上書きは拒否する
      const credentialId = Buffer.from(registrationInfo.credential.id, "base64url");
      if (await credentials.getCredential(credentialId)) return reject("このパスキーはすでに登録されています", 409);

      const transports = readTransports(clientResponse.response.transports);
      cred = {
        credentialId,
        userId: reg.user.id,
        userHandle: new TextEncoder().encode(reg.user.id),
        publicKey,
        algorithm: ES256,
        signCount: registrationInfo.credential.counter,
        backupEligible: registrationInfo.credentialDeviceType === "multiDevice",
        status: "active",
        ...(transports ? { transports } : {}),
      };
    } catch (e) {
      // ライブラリの例外の文面には、保存してある challenge がそのまま入るので、伏せてから出す
      // （ログを読めるだけで、確認コードなしに登録を完了できてしまうため）
      const reason = e instanceof Error ? e.message : String(e);
      log.warn("パスキーの検証に失敗しました", reason.replaceAll(reg.challenge, "(challenge)"));
      return reject("パスキーを検証できませんでした");
    }

    // 保存の前にトークンを使用済みにする。同じトークンで同時に 2 回届いても、確定できるのは 1 回だけ
    // （この先は await を挟まないので、間に別のリクエストは入らない）
    if (!registrations.markUsed(token)) return invalidToken(c);
    try {
      credentials.add(cred);
    } catch (e) {
      if (e instanceof CredentialExistsError) return c.json({ error: "このパスキーはすでに登録されています" }, 409);
      if (e instanceof UserNotFoundError) return invalidToken(c);
      throw e;
    }
    return c.json({ ok: true });
  });

  return app;
}
