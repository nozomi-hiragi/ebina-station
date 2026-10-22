/**
 * 埋め込みアプリの子プロセスで動く。Station（src/apps/supervisor.ts）が次の形で起動する。
 *
 *   deno run <権限> runner/runner.ts <entry の file URL>
 *
 * 先に 127.0.0.1:EBINA_PORT で待ち受けを始め（entry の読み込みが済むまでは 503）、
 * entry を import して、default export の `fetch` をアプリとして使う。
 * `Ebina-App-Token` が EBINA_APP_TOKEN と一致しないリクエストはアプリに渡さない。
 * 読み込みが済んだら標準出力に 1 行 `EBINA_READY` を出す。
 */
import { timingSafeEqual } from "node:crypto";

const READY_LINE = "EBINA_READY";
const TOKEN_HEADER = "ebina-app-token";
/** Station が待ち受けを確かめるときのヘッダー（値は nonce）。runner が答え、アプリには渡さない */
const PROBE_HEADER = "ebina-runner-probe";
/** 確認への応答のヘッダー（HMAC-SHA256(key=token, nonce) の hex） */
const PROOF_HEADER = "ebina-runner-proof";
const NONCE_MAX = 256;

type Handler = (req: Request) => Response | Promise<Response>;

function fail(message: string): never {
  console.error(`runner: ${message}`);
  Deno.exit(1);
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** default export が関数ならそれを、`fetch` を持つオブジェクトならその fetch を使う */
function resolveHandler(module: unknown): Handler | undefined {
  if (typeof module !== "object" || module === null) return undefined;
  const exported = (module as { default?: unknown }).default;
  if (typeof exported === "function") return exported as Handler;
  if (typeof exported === "object" && exported !== null) {
    const fetchFn = (exported as { fetch?: unknown }).fetch;
    if (typeof fetchFn === "function") return (req) => (fetchFn as Handler).call(exported, req);
  }
  return undefined;
}

function jsonResponse(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status });
}

const entryUrl = Deno.args[0];
if (entryUrl === undefined) fail("entry の URL が渡されていません");
const portText = Deno.env.get("EBINA_PORT");
const token = Deno.env.get("EBINA_APP_TOKEN");
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail("EBINA_PORT が正しくありません");
if (token === undefined || token.length === 0) fail("EBINA_APP_TOKEN がありません");

// 長さをそろえてから定数時間で比べる
const encoder = new TextEncoder();
const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
async function tokenMatches(value: string | null): Promise<boolean> {
  if (value === null) return false;
  const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return timingSafeEqual(actual, expected);
}

/** 確認の nonce に対する HMAC-SHA256(key=token) を hex で返す。Station だけが同じ値を作れる */
const hmacKey = await crypto.subtle.importKey(
  "raw",
  encoder.encode(token),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);
async function proofFor(nonce: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(nonce)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** entry の読み込みが済むまでは undefined。その間は確認にも通常のリクエストにも 503 を返す */
const state: { handler?: Handler } = {};

function notReady(): Response {
  return jsonResponse(503, "starting");
}

// entry を読み込む前に待ち受けを始める。読み込みの間にほかのプロセスがポートを取るのを防ぐ
let server: Deno.HttpServer;
try {
  server = Deno.serve({
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  }, async (req) => {
    // 確認はトークンを受け取らない。nonce への HMAC で、トークンを知る runner だと示す
    const nonce = req.headers.get(PROBE_HEADER);
    if (nonce !== null) {
      if (state.handler === undefined) return notReady();
      if (nonce.length === 0 || nonce.length > NONCE_MAX) return jsonResponse(400, "invalid_probe");
      return new Response(null, { status: 204, headers: { [PROOF_HEADER]: await proofFor(nonce) } });
    }
    if (!await tokenMatches(req.headers.get(TOKEN_HEADER))) return jsonResponse(403, "forbidden");
    if (state.handler === undefined) return notReady();
    try {
      const response = await state.handler(req);
      if (!(response instanceof Response)) throw new TypeError("fetch が Response を返しませんでした");
      return response;
    } catch (error) {
      // 理由は応答に出さない
      console.error(`fetch が失敗しました: ${describe(error)}`);
      return jsonResponse(500, "internal_error");
    }
  });
} catch (error) {
  fail(`待ち受けを始められません: ${describe(error)}`);
}

let loaded: unknown;
try {
  loaded = await import(entryUrl);
} catch (error) {
  fail(`entry を読み込めません: ${describe(error)}`);
}
const resolved = resolveHandler(loaded);
if (resolved === undefined) {
  fail("entry の default export に fetch がありません（`export default { fetch(req) { … } }` の形にしてください）");
}
state.handler = resolved;
console.log(READY_LINE);

// Station が止めたとき（SIGTERM）は、処理中のリクエストを待ってから終わる。待ちすぎないよう上限を付ける
function shutdown(): void {
  const timer = setTimeout(() => Deno.exit(0), 2_000);
  Deno.unrefTimer(timer);
  server.shutdown().finally(() => Deno.exit(0));
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  try {
    Deno.addSignalListener(signal, shutdown);
  } catch {
    // この OS では扱えないシグナル
  }
}

// Station が突然いなくなったら、取り残されないよう自分で終わる
const parentPid = Deno.ppid;
const watcher = setInterval(() => {
  if (Deno.ppid !== parentPid) Deno.exit(0);
}, 2_000);
Deno.unrefTimer(watcher);
