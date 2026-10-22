import type { EtHandler, EtHandlerResponse } from "@wake-protocol/server";
import type { AppHub } from "../apps/types.ts";
import { isValidAppName } from "../apps/names.ts";
import type { StationConfig } from "../config.ts";
import type { SqliteCredentialStore } from "../db/credentials.ts";
import type { UserRepo } from "../db/users.ts";
import { log } from "../log.ts";
import { buildEntrance } from "./entrance.ts";
import { etError, etJson, etUnauthorized } from "./respond.ts";

/** ET で運ぶ Station の URL の先頭 */
const ET_ORIGIN = "wake://station";

/** ET の URL を振り分けた結果。path は "/" 始まりでクエリを含む（アプリの中のパス） */
export type EtTarget =
  | { kind: "me" }
  | { kind: "entrance" }
  | { kind: "app"; name: string; path: string }
  | { kind: "error"; status: 400 | 404; code: "invalid_url" | "not_found" };

const NOT_FOUND: EtTarget = { kind: "error", status: 404, code: "not_found" };
const INVALID_URL: EtTarget = { kind: "error", status: 400, code: "invalid_url" };

/** 区切りの印（%2f、%5c）。大文字小文字は問わない */
const ENCODED_SEPARATOR = /%2f|%5c/i;

/** パスの 1 区間が `.`・`..`（%2e での書き方を含む）や制御文字・バックスラッシュを含むなら true。デコードできないものも true */
function isUnsafeSegment(segment: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  if (decoded === "." || decoded === "..") return true;
  for (const ch of decoded) {
    const code = ch.codePointAt(0) ?? 0;
    // バックスラッシュは URL の解釈で / と同じに扱われることがあるため、区切りの印（%5c）と同じく受け付けない
    if (code < 0x20 || code === 0x7f || ch === "\\") return true;
  }
  return false;
}

/**
 * ET の URL（`wake://station/…`）を、Station 自身（me、入口）かアプリへの中継かに振り分ける。
 * パスの区切りに `.`・`..`・空（`//`）・`%2f`・`%5c` を含むものは invalid_url。
 * 予約名、アプリ名の規則に合わないもの、知らない形は not_found
 */
export function resolveEtTarget(url: string): EtTarget {
  if (!url.startsWith(`${ET_ORIGIN}/`)) return NOT_FOUND;
  const rest = url.slice(ET_ORIGIN.length);
  const queryAt = rest.indexOf("?");
  const path = queryAt < 0 ? rest : rest.slice(0, queryAt);
  const query = queryAt < 0 ? "" : rest.slice(queryAt);

  if (ENCODED_SEPARATOR.test(path)) return INVALID_URL;
  const parts = path.slice(1).split("/");
  // 最後の空は末尾の / （例 /notes/files/）として許す。途中の空（//）は許さない
  for (const [i, part] of parts.entries()) {
    if (part === "" ? i < parts.length - 1 : isUnsafeSegment(part)) return INVALID_URL;
  }

  if (path === "/me") return { kind: "me" };
  if (path === "/index.bina") return { kind: "entrance" };

  const first = parts[0];
  // /<名前>.bina はアプリの /index.bina。その後ろに続きがある形は、名前に . が入るため下で not_found になる
  const staticName = parts.length === 1 && first.endsWith(".bina") ? first.slice(0, -".bina".length) : undefined;
  const name = staticName ?? first;
  if (!isValidAppName(name)) return NOT_FOUND;
  if (staticName !== undefined) return { kind: "app", name, path: `/index.bina${query}` };
  return { kind: "app", name, path: `/${parts.slice(1).join("/")}${query}` };
}

export interface EtHandlerDeps {
  config: StationConfig;
  users: UserRepo;
  credentials: SqliteCredentialStore;
  hub: AppHub;
}

/** ET の処理。ログイン中のユーザーとパスキーが DB に残っているかを毎回確かめてから振り分ける */
export function createEtHandler(deps: EtHandlerDeps): EtHandler {
  const { config, users, credentials, hub } = deps;
  const notFound = (): EtHandlerResponse => etError(404, "not_found");
  const methodNotAllowed = (): EtHandlerResponse => {
    const res = etError(405, "method_not_allowed");
    return { ...res, headers: [...(res.headers ?? []), ["allow", "GET, HEAD"]] };
  };
  // GET と HEAD だけ許す。HEAD は GET と同じステータスとヘッダーで、本文を空にする
  const getOnly = (method: string, make: () => EtHandlerResponse): EtHandlerResponse => {
    if (method === "GET") return make();
    if (method === "HEAD") return { ...make(), body: new Uint8Array(0) };
    return methodNotAllowed();
  };

  return async (req, auth) => {
    // CLI で消されたユーザー・パスキーのセッションは Station のメモリに残るため、ここで止める
    const user = users.get(auth.userId);
    if (!user || !credentials.isActive(auth.credentialId, auth.userId)) {
      return etUnauthorized();
    }

    const target = resolveEtTarget(req.url);
    switch (target.kind) {
      case "error":
        return etError(target.status, target.code);
      case "me":
        return getOnly(req.method, () => etJson(200, { id: user.id, name: user.name }));
      case "entrance":
        return getOnly(req.method, () => etJson(200, buildEntrance(config, hub.list())));
      case "app": {
        const app = hub.get(target.name);
        if (!app || !app.enabled) return notFound();
        try {
          return await hub.relay(target.name, target.path, req, user.id);
        } catch (e) {
          log.error(`アプリ ${target.name} への中継で例外が起きました`, e);
          return etError(500, "internal");
        }
      }
    }
  };
}
