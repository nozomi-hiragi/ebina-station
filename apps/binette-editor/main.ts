/**
 * Binette エディタ（`docs/apps/binette-editor.md`）。Station の子プロセスとして動く entry。
 *
 * - `GET /api/binettes`、`GET|PUT|DELETE /api/binettes/<名前>`: ビネットの保存・取得・削除
 * - `GET /preview/<名前>.bina`: 保存したビネットをそのまま返す（プレビュー用）
 * - ほかのパスは 404。画面の .bina と js は、404 を受けた Station が panoplie/ から配る
 *
 * 保存先は環境変数 EBINA_DATA_DIR（Station が渡す）の下の binette/。
 */
import { parseBinette } from "@binette/core";
import { nameProblem } from "./names.ts";
import { BINETTE_MAX_COUNT, BinetteStore } from "./store.ts";

/** 保存できる本文の大きさの上限（ET で運べる本文の上限と同じ 1 MiB） */
export const BODY_MAX = 1024 * 1024;

const API_PREFIX = "/api/binettes";
const PREVIEW_PREFIX = "/preview/";
const BINA_EXTENSION = ".bina";

function jsonError(status: number, message: string, headers: HeadersInit = {}): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * プレビュー用に、ビネットの settings を除く（Scene は取得したビネットの settings を覚えて設定画面に出し続けるため）。
 * JSON として読めない、オブジェクトでない、settings が無いときは、そのまま返す
 */
function withoutSettings(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("settings" in value)) return text;
    const rest = { ...value } as Record<string, unknown>;
    delete rest.settings;
    return JSON.stringify(rest);
  } catch {
    return text;
  }
}

function methodNotAllowed(allow: string): Response {
  return jsonError(405, "このメソッドは使えません", { Allow: allow });
}

/** 本文を BODY_MAX まで読む。超えたら null（読むのをやめる）。UTF-8 として読めなければ undefined */
async function readText(req: Request): Promise<string | null | undefined> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_MAX) {
    await req.body?.cancel();
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body !== null) {
    const reader = req.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > BODY_MAX) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** データフォルダ dataDir を使うハンドラを作る */
export function createHandler(
  dataDir: string,
  options: { maxCount?: number } = {},
): (req: Request) => Promise<Response> {
  const store = new BinetteStore(dataDir, options.maxCount);

  async function putBinette(name: string, req: Request): Promise<Response> {
    const text = await readText(req);
    if (text === null) return jsonError(413, `本文が大きすぎます（${BODY_MAX / 1024 / 1024} MiB まで）`);
    if (text === undefined) return jsonError(400, "本文を UTF-8 として読めません");
    try {
      parseBinette(text);
    } catch (error) {
      return jsonError(400, error instanceof Error ? error.message : "ビネットの形式が正しくありません");
    }
    // 作るだけ（If-None-Match: *）の判定は、store の列の中で行う
    const createOnly = req.headers.get("if-none-match")?.trim() === "*";
    const result = await store.write(name, text, { createOnly });
    if (result === "exists") return jsonError(412, `ビネット「${name}」はすでにあります`);
    if (result === "full") {
      return jsonError(
        409,
        `ビネットは ${options.maxCount ?? BINETTE_MAX_COUNT} 件までです。いらないものを消してください`,
      );
    }
    return Response.json({ name }, {
      status: result === "created" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  async function api(req: Request, rest: string): Promise<Response> {
    const method = req.method;
    if (rest === "") {
      if (method !== "GET") return methodNotAllowed("GET");
      return Response.json({ names: await store.list() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!rest.startsWith("/")) return jsonError(404, "見つかりません");
    const name = rest.slice(1);
    const problem = nameProblem(name);
    if (problem !== null) return jsonError(400, problem);

    switch (method) {
      case "GET": {
        const text = await store.read(name);
        if (text === null) return jsonError(404, `ビネット「${name}」がありません`);
        return new Response(text, {
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      case "PUT":
        return await putBinette(name, req);
      case "DELETE":
        if (!await store.remove(name)) return jsonError(404, `ビネット「${name}」がありません`);
        return Response.json({ name }, { headers: { "Cache-Control": "no-store" } });
      default:
        return methodNotAllowed("GET, PUT, DELETE");
    }
  }

  async function preview(req: Request, rest: string): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed("GET, HEAD");
    if (!rest.endsWith(BINA_EXTENSION)) return jsonError(404, "見つかりません");
    const name = rest.slice(0, -BINA_EXTENSION.length);
    // 名前が正しくないものは、あるはずがないので 404
    if (nameProblem(name) !== null) return jsonError(404, "見つかりません");
    const text = await store.read(name);
    if (text === null) return jsonError(404, `ビネット「${name}」がありません`);
    return new Response(req.method === "HEAD" ? null : withoutSettings(text), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return async (req) => {
    try {
      // 名前に使える文字にパーセントエンコードは無いので、デコードせずそのまま見る
      const { pathname } = new URL(req.url);
      if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) {
        return await api(req, pathname.slice(API_PREFIX.length));
      }
      if (pathname.startsWith(PREVIEW_PREFIX)) return await preview(req, pathname.slice(PREVIEW_PREFIX.length));
      return jsonError(404, "見つかりません");
    } catch (error) {
      // 詳細は標準エラーにだけ出す（応答にはファイルのパスなどを載せない）
      console.error("binette-editor:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      return jsonError(500, "サーバーの内部でエラーが起きました");
    }
  };
}

let handler: ((req: Request) => Promise<Response>) | undefined;

/** Station の runner が使う default export。データフォルダは最初のリクエストのときに環境変数から決める */
export default {
  fetch(req: Request): Promise<Response> {
    if (handler === undefined) {
      const dataDir = Deno.env.get("EBINA_DATA_DIR");
      if (dataDir === undefined || dataDir === "") throw new Error("EBINA_DATA_DIR がありません");
      handler = createHandler(dataDir);
    }
    return handler(req);
  },
};
