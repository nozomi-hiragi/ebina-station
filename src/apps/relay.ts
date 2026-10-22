import type { EtHandlerRequest, EtHandlerResponse } from "@wake-protocol/server";
import { etError } from "../et/respond.ts";
import { log } from "../log.ts";

/** アプリの応答を待つ時間 */
export const RELAY_TIMEOUT_MS = 30_000;
/** ET で運ぶ応答の本文の上限（WAKE の既定 ET_BODY_MAX と同じ 1 MiB） */
export const RELAY_BODY_MAX = 1024 * 1024;
/** ET のヘッダーの合計の上限（名前と値の長さの合計。WAKE の規則） */
export const RELAY_HEADERS_MAX = 8 * 1024;

type EtHeaders = NonNullable<EtHandlerResponse["headers"]>;

/** 中継しないヘッダー（RFC 9110 の hop-by-hop） */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// ET のヘッダーの規則（WAKE の checkResponseHeaders と同じ）。末尾の改行も許さないため (?![\s\S]) で終える
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+(?![\s\S])/;
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*(?![\s\S])/;

export const notFound = (): EtHandlerResponse => etError(404, "not_found");
export const appUnavailable = (): EtHandlerResponse => etError(503, "app_unavailable");
export const badGateway = (): EtHandlerResponse => etError(502, "bad_gateway");

/** 中継するパスとして使えるか。`/` 始まりで、`#`・空白・制御文字・`\`・ASCII 以外を含まない */
export function isRelayPath(path: string): boolean {
  return /^\/[\x21-\x7e]*$/.test(path) && !path.includes("#") && !path.includes("\\");
}

/**
 * ET のヘッダーから、アプリへ渡すヘッダーを作る。
 * hop-by-hop、host、content-length、accept-encoding、`ebina-` で始まるもの（大小文字問わず）と、
 * connection に名前が挙がっているものを除き、Ebina-User と Ebina-App-Token を付ける。
 */
export function buildChildHeaders(headers: EtHandlerRequest["headers"], userId: string, token: string): Headers {
  const named = new Set<string>();
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== "connection") continue;
    for (const item of value.split(",")) named.add(item.trim().toLowerCase());
  }

  const result = new Headers();
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || named.has(lower) || lower.startsWith("ebina-")) continue;
    // fetch が伸ばせる圧縮だけをアプリに求めるため、クライアントの accept-encoding は渡さない（fetch が自分の値を付ける）
    if (lower === "host" || lower === "content-length" || lower === "accept-encoding") continue;
    result.append(name, value);
  }
  result.set("Ebina-User", userId);
  result.set("Ebina-App-Token", token);
  return result;
}

/**
 * アプリの応答のヘッダーから、ET で返すヘッダーを作る。
 * hop-by-hop、connection に名前が挙がっているもの、content-length、content-encoding、set-cookie、`ebina-` で始まるものは除く。
 * 名前や値が ET の規則に合わない、または合計が 8 KiB を超えるときは null。
 */
export function filterResponseHeaders(headers: Headers): EtHeaders | null {
  // connection に名前が挙がったヘッダーも hop-by-hop なので除く（リクエストの向きの buildChildHeaders と同じ）
  const named = new Set<string>();
  for (const item of (headers.get("connection") ?? "").split(",")) {
    const trimmed = item.trim().toLowerCase();
    if (trimmed !== "") named.add(trimmed);
  }
  const result: [string, string][] = [];
  let total = 0;
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || named.has(lower) || lower.startsWith("ebina-")) continue;
    // content-encoding は fetch が本文を伸ばした後なので付け直さない
    if (lower === "content-length" || lower === "content-encoding" || lower === "set-cookie") continue;
    if (!HEADER_NAME.test(name) || !HEADER_VALUE.test(value)) return null;
    total += name.length + value.length;
    if (total > RELAY_HEADERS_MAX) return null;
    result.push([lower, value]);
  }
  return result;
}

/** 本文を max バイトまで読む。超えたら読むのをやめて null */
async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Response を ET の応答にする。次のときは 502（bad_gateway）にして、理由を警告に残す（ヘッダーの値やクエリは出さない）。
 * - ステータスが 200〜599 でない
 * - ヘッダーが規則に合わない
 * - 本文が max を超える
 *
 * @param source ログに出すアプリ名
 */
export async function toEtResponse(
  response: Response,
  bodyMax: number = RELAY_BODY_MAX,
  source = "(不明)",
): Promise<EtHandlerResponse> {
  const reject = async (reason: string): Promise<EtHandlerResponse> => {
    try {
      await response.body?.cancel();
    } catch {
      // すでに閉じている
    }
    log.warn(`アプリ ${source} の応答を 502 にしました: ${reason}`);
    return badGateway();
  };

  if (response.status < 200 || response.status > 599) return await reject(`ステータス ${response.status} は使えません`);
  const headers = filterResponseHeaders(response.headers);
  if (headers === null) return await reject("ヘッダーが ET の規則に合わないか、合計が 8 KiB を超えています");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > bodyMax) {
    return await reject(`本文が ${bodyMax} バイトを超えています`);
  }
  const body = await readLimited(response.body, bodyMax);
  if (body === null) return await reject(`本文が ${bodyMax} バイトを超えています`);
  return { status: response.status, headers, body };
}

/** 中継先の子プロセス */
export interface RelayTarget {
  /** ログ用のアプリ名 */
  name: string;
  port: number;
  /** Ebina-App-Token に入れる秘密。ログには出さない */
  token: string;
  /** この子へ直接つなぐ fetch 用のクライアント。HTTP_PROXY などの環境変数のプロキシを通さないために使う */
  client?: Deno.HttpClient;
}

export interface RelayOptions {
  /** アプリの応答を待つ時間（ミリ秒）。既定 30 秒 */
  timeoutMs?: number;
  /** 応答の本文の上限（バイト）。既定 1 MiB */
  bodyMax?: number;
}

/**
 * ET のリクエストを子プロセスのアプリへ渡し、応答を ET の応答にする。
 * path は `/` 始まりでクエリを含む。つながらない・時間切れ・規則に合わない応答は 502。
 */
export async function relayToChild(
  target: RelayTarget,
  path: string,
  req: EtHandlerRequest,
  userId: string,
  options: RelayOptions = {},
): Promise<EtHandlerResponse> {
  const timeoutMs = options.timeoutMs ?? RELAY_TIMEOUT_MS;
  const bodyMax = options.bodyMax ?? RELAY_BODY_MAX;

  let headers: Headers;
  try {
    headers = buildChildHeaders(req.headers, userId, target.token);
  } catch {
    return etError(400, "invalid_header");
  }
  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const url = `http://127.0.0.1:${target.port}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? new Uint8Array(req.body) : undefined,
      redirect: "manual",
      signal: controller.signal,
      client: target.client,
    });
    // 本文を読み終えるまで時間切れの対象にする
    return await toEtResponse(response, bodyMax, target.name);
  } catch (error) {
    // エラーの文面にはクエリ付きの URL が入るので、出さない
    const detail = error instanceof Error ? error.message.replaceAll(url, "(URL)") : String(error);
    const reason = controller.signal.aborted ? "時間切れ" : detail;
    log.warn(`アプリ ${target.name} への中継に失敗しました: ${reason}`);
    return badGateway();
  } finally {
    clearTimeout(timer);
  }
}
