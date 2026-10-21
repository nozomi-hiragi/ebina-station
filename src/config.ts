/** station.json の内容（検査・正規化済み） */
export interface StationConfig {
  port: number;
  /** 正規化済みの origin（`new URL(o).origin === o`）。重複は除く */
  origins: string[];
  rpId: string;
  /** 省略時は "EbinaStation" */
  rpName: string;
  /** 末尾の / を除く */
  frontURL: string;
  /** 末尾の / を除く */
  serverURL: string;
  entrance: { redirect?: string };
}

export const DEFAULT_RP_NAME = "EbinaStation";

/** station.json が正しくないとき。field は問題のある欄（例 "origins[0]"） */
export class ConfigError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
    this.field = field;
  }
}

function fieldError(field: string, detail: string): ConfigError {
  return new ConfigError(`「${field}」${detail}`, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (value === undefined) throw fieldError(field, "がありません");
  if (typeof value !== "string") throw fieldError(field, "は文字列で書いてください");
  if (value.trim() === "") throw fieldError(field, "が空です");
  return value.trim();
}

function parsePort(value: unknown): number {
  if (value === undefined) throw fieldError("port", "がありません");
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw fieldError("port", "は 1〜65535 の整数で書いてください");
  }
  return value;
}

function parseOrigin(value: unknown, field: string): string {
  if (typeof value !== "string") throw fieldError(field, "は文字列で書いてください");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw fieldError(field, `は URL として読めません: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fieldError(field, "は http:// か https:// で始めてください");
  }
  // パス・クエリ・ユーザー情報が付いていたら誤り（origin は https://host[:port] だけ）
  if (url.href !== `${url.origin}/`) {
    throw fieldError(field, `は origin（${url.origin} の形）だけを書いてください。パスなどは付けません`);
  }
  return url.origin;
}

function parseOrigins(value: unknown): string[] {
  if (value === undefined) throw fieldError("origins", "がありません");
  if (!Array.isArray(value) || value.length === 0) {
    throw fieldError("origins", "は origin を 1 つ以上並べた配列で書いてください");
  }
  const origins = value.map((item, i) => parseOrigin(item, `origins[${i}]`));
  return [...new Set(origins)];
}

function parseRpId(value: unknown, origins: string[]): string {
  const rpId = requireString(value, "rpId");
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(rpId)) {
    throw fieldError("rpId", "はホスト名（小文字）だけを書いてください。https:// やポート、パスは付けません");
  }
  // WebAuthn は、origin のホスト名が RP ID と同じか、そのサブドメインであることを求める
  for (const origin of origins) {
    const host = new URL(origin).hostname;
    if (host !== rpId && !host.endsWith(`.${rpId}`)) {
      throw fieldError(
        "rpId",
        `「${rpId}」は origins の ${origin} のホスト名と合いません。同じか、親のドメインにしてください`,
      );
    }
  }
  return rpId;
}

function parseRpName(value: unknown): string {
  if (value === undefined) return DEFAULT_RP_NAME;
  return requireString(value, "rpName");
}

/** http(s) の URL を検査し、末尾の / を除いて返す */
function parseBaseURL(value: unknown, field: string): string {
  const text = requireString(value, field);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw fieldError(field, `は URL として読めません: ${text}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fieldError(field, "は http:// か https:// で始めてください");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw fieldError(field, "にユーザー情報・クエリ・# を付けることはできません");
  }
  return url.href.replace(/\/+$/, "");
}

function hasSpaceOrControl(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** `/` 始まりのパスから、クエリと # を除き、. と .. を解決した pathname を返す */
function normalizedPath(value: string): string {
  const { pathname } = new URL(value, "https://scene.invalid/");
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function parseRedirect(value: unknown): string {
  const field = "entrance.redirect";
  if (typeof value !== "string") throw fieldError(field, "は文字列で書いてください");
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw fieldError(field, "は / で始まる Scene 内のパスで書いてください（例 /binette-editor）");
  }
  if (hasSpaceOrControl(value)) {
    throw fieldError(field, "に空白や制御文字を含めることはできません");
  }
  // Scene はクエリと # を見ずにパスで比べ、/index を / へ寄せる。. や .. を解決し、% を戻したパスで判定する
  const path = normalizedPath(value);
  if (path === "/" || path === "/index") {
    throw fieldError(
      field,
      "を / や /index（クエリや # を付けたものを含む）にすると入口に戻り続けます。別のパスにしてください",
    );
  }
  return value;
}

function parseEntrance(value: unknown): StationConfig["entrance"] {
  if (value === undefined) return {};
  if (!isRecord(value)) throw fieldError("entrance", "はオブジェクトで書いてください");
  if (value.redirect === undefined) return {};
  return { redirect: parseRedirect(value.redirect) };
}

/**
 * station.json の中身（JSON.parse した値）を検査して StationConfig にする。
 * 知らない欄は無視する。不正なら ConfigError（どの欄かを日本語で示す）を投げる。
 */
export function parseStationConfig(value: unknown): StationConfig {
  if (!isRecord(value)) throw new ConfigError("設定はオブジェクトで書いてください");
  const port = parsePort(value.port);
  const origins = parseOrigins(value.origins);
  const rpId = parseRpId(value.rpId, origins);
  const rpName = parseRpName(value.rpName);
  const frontURL = parseBaseURL(value.frontURL, "frontURL");
  const serverURL = parseBaseURL(value.serverURL, "serverURL");
  const entrance = parseEntrance(value.entrance);
  return { port, origins, rpId, rpName, frontURL, serverURL, entrance };
}

/** station.json を読んで検査する。無い・読めない・不正なときは ConfigError */
export async function loadStationConfig(path: string): Promise<StationConfig> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new ConfigError(
        `設定ファイルが見つかりません: ${path}\n` +
          "examples/station.json を参考に作ってください（docs/station-json.md に欄の説明があります）",
        undefined,
        { cause: e },
      );
    }
    const reason = e instanceof Error ? e.message : String(e);
    throw new ConfigError(`設定ファイルを読み込めません: ${path}（${reason}）`, undefined, { cause: e });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ConfigError(`${path} を JSON として読めません: ${reason}`, undefined, { cause: e });
  }

  try {
    return parseStationConfig(json);
  } catch (e) {
    if (e instanceof ConfigError) {
      throw new ConfigError(`${path} が正しくありません。${e.message}`, e.field, { cause: e });
    }
    throw e;
  }
}
