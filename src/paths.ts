import { join, resolve } from "@std/path";
import { isAppNameFormat } from "./apps/names.ts";

/** project フォルダの中の決まった場所 */
export interface ProjectPaths {
  /** project フォルダ（絶対パス） */
  root: string;
  /** `<root>/station.json` */
  config: string;
  /** `<root>/data/station/station.db` */
  db: string;
  /** `<root>/apps` */
  appsDir: string;
  /** `<root>/data/apps/<name>`。name はアプリ名の形式でなければ投げる */
  appDataDir(name: string): string;
}

/** 環境変数で project フォルダを指定しないときの場所 */
export const DEFAULT_PROJECT_DIR = "./project";

/**
 * project フォルダのパスを組み立てる。
 * root を省略すると、環境変数 EBINA_PROJECT_DIR、無ければ ./project を絶対パスにして使う。
 */
export function projectPaths(root?: string): ProjectPaths {
  const base = resolve(root ?? (Deno.env.get("EBINA_PROJECT_DIR") || DEFAULT_PROJECT_DIR));
  return {
    root: base,
    config: join(base, "station.json"),
    db: join(base, "data", "station", "station.db"),
    appsDir: join(base, "apps"),
    appDataDir(name: string): string {
      // パスの部品として使うので、形式に合わない名前（.. や区切り文字を含むもの）は受け付けない
      if (!isAppNameFormat(name)) {
        throw new Error(`アプリ名の形式が正しくありません: ${JSON.stringify(name)}`);
      }
      return join(base, "data", "apps", name);
    },
  };
}
