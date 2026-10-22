import type { EtHandlerRequest, EtHandlerResponse } from "@wake-protocol/server";
import { etError } from "../et/respond.ts";
import { log } from "../log.ts";
import type { ProjectPaths } from "../paths.ts";
import type { LoadedApp } from "./manifest.ts";
import { symlinkInChain } from "./links.ts";
import { isValidAppName } from "./names.ts";
import { scanApps } from "./registry.ts";
import { appUnavailable, isRelayPath, notFound, type RelayOptions, relayToChild } from "./relay.ts";
import { createStaticSite, type StaticSite } from "./static.ts";
import { type AppLogLine, AppSupervisor, type SupervisorOptions } from "./supervisor.ts";
import type { AppHub, AppInfo, AppStatus } from "./types.ts";

export interface AppHubDeps {
  paths: ProjectPaths;
  /** アプリの有効・無効。AppStateRepo をそのまま渡せる */
  states: { isEnabled(name: string): boolean };
  /** 子プロセスの設定の上書き（猶予や再起動の間隔。テスト用） */
  supervisor?: Partial<
    Pick<
      SupervisorOptions,
      | "runnerPath"
      | "configPath"
      | "startTimeoutMs"
      | "stopTimeoutMs"
      | "restartBaseMs"
      | "restartMaxMs"
      | "crashWindowMs"
      | "crashLimit"
      | "maxLogLines"
    >
  >;
  /** 中継の設定の上書き（時間切れや本文の上限。テスト用） */
  relay?: RelayOptions;
}

/** AppHub に、アプリごとのログを読む口を足したもの（アプリ管理の画面用） */
export interface EmbeddedAppHub extends AppHub {
  /** 子プロセスの最新のログ（古い順）。子プロセスを持たないアプリや、無いアプリは空 */
  logs(name: string): AppLogLine[];
  /** 止め始めたことを知らせる。以後は子が終わっても再起動せず、reload も何もしない */
  beginStop(): void;
  /** 知っているすべての子プロセスに同期で SIGKILL を送る（Station を強制終了する直前用） */
  killAllSync(): void;
}

interface AppRecord {
  name: string;
  loaded: LoadedApp | undefined;
  /** app.json やフォルダの不正、起動できない理由 */
  error: string | undefined;
  enabled: boolean;
  /** 変わったかを調べるための、読み込んだ内容の写し */
  signature: string;
  supervisor: AppSupervisor | undefined;
  site: StaticSite | undefined;
}

function isAlive(status: AppStatus): boolean {
  return status === "starting" || status === "running";
}

/** 埋め込みアプリ（apps/ のフォルダ）を走査・起動・中継する部品をまとめる */
export function createAppHub(deps: AppHubDeps): EmbeddedAppHub {
  const { paths, states } = deps;
  let scannedOnce = false;
  let records = new Map<string, AppRecord>();
  let queue: Promise<unknown> = Promise.resolve();
  let stopping = false;
  /** 止まりきるまでの子の見張り（入れ替えで止めている最中のものも含む） */
  const live = new Set<AppSupervisor>();

  /** start / reload / stop を 1 つずつ行う */
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  function toInfo(record: AppRecord): AppInfo {
    const { loaded, supervisor } = record;
    let status: AppStatus;
    if (record.error !== undefined) status = "error";
    else if (!record.enabled) status = "stopped";
    else status = supervisor?.status ?? "running";
    const info: AppInfo = {
      name: record.name,
      label: loaded?.manifest.label ?? record.name,
      enabled: record.enabled,
      status,
      kind: "embedded",
    };
    if (loaded?.manifest.icon !== undefined) info.icon = loaded.manifest.icon;
    if (loaded?.manifest.version !== undefined) info.version = loaded.manifest.version;
    if (loaded?.manifest.description !== undefined) info.description = loaded.manifest.description;
    const error = record.error ?? (status === "error" ? supervisor?.error : undefined);
    if (error !== undefined) info.error = error;
    return info;
  }

  function newSupervisor(name: string, loaded: LoadedApp & { entry: string }): AppSupervisor {
    const supervisor = new AppSupervisor({
      ...deps.supervisor,
      name,
      appDir: loaded.appDir,
      dataDir: paths.appDataDir(name),
      entry: loaded.entry,
      projectRoot: paths.root,
    });
    live.add(supervisor);
    return supervisor;
  }

  /** apps/ を読み直して、起動・停止を今の状態に合わせる */
  async function sync(): Promise<void> {
    if (stopping) return;
    // project から apps/ までの途中がリンクなら、リンク先を走査・配信しないよう、アプリ 0 件として扱う
    const chainProblem = await symlinkInChain(paths.root, paths.appsDir, "apps/");
    if (chainProblem !== null) log.warn(`${chainProblem}。アプリを読み込みません`);
    const scanned = chainProblem === null ? await scanApps(paths.appsDir) : [];
    const next = new Map<string, AppRecord>();
    const retiring: AppSupervisor[] = [];
    const starting: AppSupervisor[] = [];

    for (const app of scanned) {
      const previous = records.get(app.name);
      const enabled = states.isEnabled(app.name);
      let error = app.error;
      let site: StaticSite | undefined;
      if (error === undefined && enabled && app.loaded?.panoplieDir !== undefined) {
        try {
          site = await createStaticSite(app.loaded.panoplieDir, app.name);
        } catch (cause) {
          error = `panoplie/ を読み込めません: ${cause instanceof Error ? cause.message : String(cause)}`;
        }
      }

      const loaded = app.loaded;
      const signature = JSON.stringify([loaded?.manifest, loaded?.entry, loaded?.panoplieDir, error, enabled]);
      const wantsChild = error === undefined && enabled && loaded?.entry !== undefined;

      let supervisor: AppSupervisor | undefined;
      if (
        previous?.supervisor !== undefined && wantsChild && previous.signature === signature &&
        isAlive(previous.supervisor.status)
      ) {
        // 変わっておらず動いているものはそのままにする
        supervisor = previous.supervisor;
      } else {
        if (previous?.supervisor !== undefined) retiring.push(previous.supervisor);
        if (wantsChild && loaded?.entry !== undefined) {
          supervisor = newSupervisor(app.name, { ...loaded, entry: loaded.entry });
          starting.push(supervisor);
        }
      }
      next.set(app.name, { name: app.name, loaded, error, enabled, signature, supervisor, site });
    }
    for (const [name, previous] of records) {
      if (!next.has(name) && previous.supervisor !== undefined) retiring.push(previous.supervisor);
    }

    records = next;
    scannedOnce = true;
    await Promise.all(retiring.map((supervisor) => supervisor.stop().then(() => live.delete(supervisor))));
    await Promise.all(starting.map((supervisor) => supervisor.start()));
    log.info(
      `アプリを ${next.size} 件読み込みました（子プロセス ${
        [...next.values()].filter((r) => r.supervisor).length
      } 件）`,
    );
  }

  async function relay(
    name: string,
    path: string,
    req: EtHandlerRequest,
    userId: string,
  ): Promise<EtHandlerResponse> {
    if (!isValidAppName(name)) return notFound();
    const record = records.get(name);
    if (record === undefined || !record.enabled) return notFound();
    if (!isRelayPath(path)) return etError(400, "invalid_url");
    if (record.error !== undefined) return appUnavailable();

    const method = req.method.toUpperCase();
    if (record.supervisor !== undefined) {
      const target = record.supervisor.target();
      if (target === undefined) return appUnavailable();
      const response = await relayToChild({ name, ...target }, path, req, userId, deps.relay);
      // entry と panoplie/ の両方があるアプリは、子が 404 のときだけ panoplie/ から探す
      if (response.status === 404 && record.site !== undefined && (method === "GET" || method === "HEAD")) {
        const fallback = await record.site.handle(method, path);
        if (fallback.status !== 404) return fallback;
      }
      return response;
    }
    if (record.site !== undefined) return await record.site.handle(method, path);
    return appUnavailable();
  }

  return {
    list: () => [...records.values()].map(toInfo).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    get: (name) => {
      const record = records.get(name);
      return record === undefined ? undefined : toInfo(record);
    },
    relay,
    scanned: () => scannedOnce,
    start: () => exclusive(sync),
    reload: () => exclusive(sync),
    stop: () =>
      exclusive(async () => {
        await Promise.all([...records.values()].map((record) => record.supervisor?.stop()));
        live.clear();
      }),
    beginStop: () => {
      stopping = true;
      for (const supervisor of live) supervisor.beginStop();
    },
    killAllSync: () => {
      stopping = true;
      for (const supervisor of live) supervisor.killSync();
    },
    logs: (name) => records.get(name)?.supervisor?.logs() ?? [],
  };
}
