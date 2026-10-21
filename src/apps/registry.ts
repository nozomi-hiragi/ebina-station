import { join } from "@std/path";
import { log } from "../log.ts";
import { loadApp, type LoadedApp, ManifestError } from "./manifest.ts";
import { isAppNameFormat, validateAppName } from "./names.ts";

/** apps/ で見つけたアプリ。読み込めたら loaded、不正なら error に日本語の理由が入る */
export interface RegisteredApp {
  name: string;
  /** アプリのフォルダ（絶対パス） */
  dir: string;
  loaded?: LoadedApp;
  error?: string;
}

async function hasManifestFile(dir: string): Promise<boolean> {
  try {
    await Deno.lstat(join(dir, "app.json"));
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    // 読めないときは app.json がある前提で進め、読み込みの異常として見せる
    return true;
  }
}

async function readApp(name: string, dir: string): Promise<RegisteredApp> {
  const reason = validateAppName(name);
  // 予約名は形式に合っていても使えない。異常として見せる
  if (reason !== null) return { name, dir, error: reason };
  try {
    return { name, dir, loaded: await loadApp(dir) };
  } catch (error) {
    if (error instanceof ManifestError) return { name, dir, error: error.message };
    const message = error instanceof Error ? error.message : String(error);
    return { name, dir, error: `読み込みに失敗しました: ${message}` };
  }
}

/**
 * appsDir の直下を走査して、アプリを名前順に返す。
 * appsDir が無ければ空。シンボリックリンクと `.` で始まるものは無視し、
 * アプリ名の形式に合わないフォルダは警告を出して無視する。app.json の無いフォルダはアプリではない。
 */
export async function scanApps(appsDir: string): Promise<RegisteredApp[]> {
  const folders: string[] = [];
  try {
    for await (const entry of Deno.readDir(appsDir)) {
      if (entry.name.startsWith(".") || entry.isSymlink || !entry.isDirectory) continue;
      folders.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }

  const apps: RegisteredApp[] = [];
  for (const name of folders.sort()) {
    if (!isAppNameFormat(name)) {
      log.warn(`apps/${name} はアプリ名の形式に合わないため無視します（英小文字で始め、英小文字・数字・- だけ）`);
      continue;
    }
    const dir = join(appsDir, name);
    if (!await hasManifestFile(dir)) continue;
    apps.push(await readApp(name, dir));
  }
  return apps;
}
