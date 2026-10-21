import { isAbsolute, join, SEPARATOR } from "@std/path";
import { symlinkProblem } from "./links.ts";

/** app.json の中身（`docs/app-json.md`）。知らない欄は持たない */
export interface AppManifest {
  label: string;
  version?: string;
  description?: string;
  icon?: string;
  /** 子プロセスで動かす module。アプリのフォルダからの相対パス */
  entry?: string;
}

/** app.json やアプリのフォルダの不正。message は日本語の理由 */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/** 読み込む app.json の大きさの上限 */
const MANIFEST_MAX_BYTES = 64 * 1024;

/** app.json とフォルダの中身を確かめた結果 */
export interface LoadedApp {
  manifest: AppManifest;
  /** アプリのフォルダ（絶対パス） */
  appDir: string;
  /** entry の絶対パス。entry が無ければ undefined */
  entry?: string;
  /** panoplie/ の絶対パス。無ければ undefined */
  panoplieDir?: string;
}

/** entry に書けないパスの理由を日本語で返す。使えるなら null（実在の確認は {@link loadApp} が行う） */
export function validateEntryPath(entry: string): string | null {
  if (entry.length === 0) return "entry が空です";
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(entry)) return "entry に制御文字は使えません";
  if (entry.includes("\\")) return "entry に \\ は使えません。区切りは / で書いてください";
  if (entry.startsWith("/") || isAbsolute(entry) || /^[A-Za-z]:/.test(entry)) {
    return "entry は絶対パスにできません。アプリのフォルダからの相対パスで書いてください";
  }
  if (entry.split("/").includes("..")) return "entry に .. は使えません。アプリのフォルダの外は指せません";
  return null;
}

function optionalString(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ManifestError(`${key} は文字列で書いてください`);
  return value;
}

/** 読み込んだ JSON の値を検査する。知らない欄は無視する */
export function parseManifest(value: unknown): AppManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError("app.json はオブジェクトで書いてください");
  }
  const object = value as Record<string, unknown>;

  const rawLabel = object.label;
  if (rawLabel === undefined) throw new ManifestError("label がありません。表示名を文字列で書いてください");
  if (typeof rawLabel !== "string") throw new ManifestError("label は文字列で書いてください");
  const label = rawLabel.trim();
  if (label.length === 0) throw new ManifestError("label が空です。表示名を書いてください");

  const manifest: AppManifest = { label };
  const version = optionalString(object, "version");
  if (version !== undefined) manifest.version = version;
  const description = optionalString(object, "description");
  if (description !== undefined) manifest.description = description;
  const icon = optionalString(object, "icon");
  if (icon !== undefined) manifest.icon = icon;
  const entry = optionalString(object, "entry");
  if (entry !== undefined) {
    const reason = validateEntryPath(entry);
    if (reason !== null) throw new ManifestError(reason);
    manifest.entry = entry;
  }
  return manifest;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readManifestFile(appDir: string): Promise<unknown> {
  const path = join(appDir, "app.json");
  let text: string;
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) throw new ManifestError("app.json がファイルではありません");
    if (stat.size > MANIFEST_MAX_BYTES) {
      throw new ManifestError(`app.json が大きすぎます（${MANIFEST_MAX_BYTES / 1024} KiB まで）`);
    }
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    if (error instanceof Deno.errors.NotFound) throw new ManifestError("app.json がありません");
    throw new ManifestError(`app.json を読めません: ${errorMessage(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ManifestError(`app.json を JSON として読めません: ${errorMessage(error)}`);
  }
}

/** entry が実在するファイルで、アプリのフォルダの外へ出ていないことを確かめ、絶対パスを返す */
async function resolveEntry(appDir: string, entry: string): Promise<string> {
  const path = join(appDir, entry);
  let realEntry: string;
  let realAppDir: string;
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) throw new ManifestError(`entry がファイルではありません: ${entry}`);
    realEntry = await Deno.realPath(path);
    realAppDir = await Deno.realPath(appDir);
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    if (error instanceof Deno.errors.NotFound) throw new ManifestError(`entry のファイルがありません: ${entry}`);
    throw new ManifestError(`entry を確かめられません: ${errorMessage(error)}`);
  }
  // シンボリックリンクでフォルダの外へ出るものは受け付けない
  if (!realEntry.startsWith(realAppDir + SEPARATOR)) {
    throw new ManifestError(`entry がアプリのフォルダの外を指しています: ${entry}`);
  }
  return path;
}

async function findPanoplie(appDir: string): Promise<string | undefined> {
  const path = join(appDir, "panoplie");
  try {
    const stat = await Deno.lstat(path);
    if (stat.isSymlink) throw new ManifestError("panoplie/ をシンボリックリンクにはできません");
    if (!stat.isDirectory) throw new ManifestError("panoplie がフォルダではありません");
    return path;
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw new ManifestError(`panoplie/ を確かめられません: ${errorMessage(error)}`);
  }
}

/** アプリのフォルダにシンボリックリンクが無いことを確かめる。app.json を読む前に行う（リンク先を読まないため） */
async function assertNoSymlinks(appDir: string): Promise<void> {
  let problem: string | null;
  try {
    problem = await symlinkProblem(appDir, "アプリのフォルダ");
  } catch (error) {
    throw new ManifestError(`アプリのフォルダを調べられません: ${errorMessage(error)}`);
  }
  if (problem !== null) throw new ManifestError(problem);
}

/**
 * アプリのフォルダを読み、app.json と entry・panoplie/ を確かめる。
 * フォルダの中にシンボリックリンクがあるもの、entry も panoplie/ も無いアプリは異常として投げる。
 *
 * @throws {ManifestError} 理由は日本語
 */
export async function loadApp(appDir: string): Promise<LoadedApp> {
  await assertNoSymlinks(appDir);
  const manifest = parseManifest(await readManifestFile(appDir));
  const loaded: LoadedApp = { manifest, appDir };
  if (manifest.entry !== undefined) loaded.entry = await resolveEntry(appDir, manifest.entry);
  loaded.panoplieDir = await findPanoplie(appDir);
  if (loaded.entry === undefined && loaded.panoplieDir === undefined) {
    throw new ManifestError("entry も panoplie/ もありません。どちらかが必要です");
  }
  return loaded;
}
