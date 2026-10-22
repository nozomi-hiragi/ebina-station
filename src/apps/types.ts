import type { EtHandlerRequest, EtHandlerResponse } from "@wake-protocol/server";

/** 埋め込みアプリの子プロセスの状態 */
export type AppStatus = "stopped" | "starting" | "running" | "error";

export interface AppInfo {
  name: string;
  label: string;
  icon?: string;
  version?: string;
  description?: string;
  enabled: boolean;
  status: AppStatus;
  kind: "embedded";
  /** app.json の不正や起動失敗の理由 */
  error?: string;
}

/** ET の処理（et/handler.ts）とアプリの部品（apps/hub.ts）の境界 */
export interface AppHub {
  /** 名前順 */
  list(): AppInfo[];
  get(name: string): AppInfo | undefined;
  /** name のアプリへ中継する。path は "/" 始まりでクエリを含む（例 "/a/b.bina?x=1"）。userId は ET の auth.userId */
  relay(name: string, path: string, req: EtHandlerRequest, userId: string): Promise<EtHandlerResponse>;
  /** 最初の走査が済んだか。済むまでは get / list が空で、アプリが無いのかまだ分からない。start が投げたら Station は起動しないので、失敗後の扱いは決めない */
  scanned(): boolean;
  /** apps/ を走査して、有効で entry のあるアプリの子プロセスを起動する */
  start(): Promise<void>;
  /** 再走査。増えたものを起動し、消えたものを止める */
  reload(): Promise<void>;
  /** 子プロセスをすべて止める */
  stop(): Promise<void>;
}
