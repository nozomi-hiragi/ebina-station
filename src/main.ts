import { ConfigError, loadStationConfig } from "./config.ts";
import { AppStateRepo } from "./db/app_states.ts";
import { SqliteCredentialStore } from "./db/credentials.ts";
import { openDatabase } from "./db/mod.ts";
import { RegistrationRepo } from "./db/registrations.ts";
import { UserRepo } from "./db/users.ts";
import { createAppHub } from "./apps/hub.ts";
import { createEtHandler } from "./et/handler.ts";
import { createHttpApp } from "./http/app.ts";
import { log } from "./log.ts";
import { type ProjectPaths, projectPaths } from "./paths.ts";
import { createStationWake } from "./wake.ts";

/** 終了のとき、処理中のリクエストを待つ時間。過ぎたら待たずに片付ける */
const SHUTDOWN_GRACE_MS = 5000;
/** 最初のシグナルからこの時間より後に届いたシグナルは、強制終了の求めとして扱う */
const REPEATED_SIGNAL_MS = 1000;

/** 動いている Station の子プロセスを同期で SIGKILL する関数（強制終了の直前に使う） */
const killers = new Set<() => void>();

/** HTTP のポートが使用中で待ち受けられないとき */
export class PortInUseError extends Error {
  readonly port: number;

  constructor(port: number, cause?: unknown) {
    super(
      `ポート ${port} は使用中です。station.json の port を変えるか、使っているプロセスを止めてください`,
      { cause },
    );
    this.name = "PortInUseError";
    this.port = port;
  }
}

/** 起動した Station */
export interface RunningStation {
  /** 待ち受けているポート */
  readonly port: number;
  /** 新しい接続を止め、アプリの子プロセスを止め、DB を閉じる。何度呼んでもよい */
  stop(): Promise<void>;
}

export interface StartOptions {
  /** station.json の port の代わりに使うポート（0 で OS 任せ。テスト用） */
  port?: number;
  /** 待ち受けるアドレス。省略すると Deno の既定（すべてのインターフェース）。テストでは 127.0.0.1 にする */
  hostname?: string;
}

/**
 * Station を起動する。設定 → DB → WAKE → HTTP の待ち受け → アプリの起動の順に組み立てて、アプリが起動してから返す。
 * 設定が正しくなければ ConfigError、ポートが使用中なら PortInUseError（アプリを起動する前に失敗する）。途中で失敗したら、ここまでに作ったものを片付けてから投げる
 */
export async function startStation(paths: ProjectPaths, options: StartOptions = {}): Promise<RunningStation> {
  const config = await loadStationConfig(paths.config);
  const db = openDatabase(paths.db, { root: paths.root });
  const hub = createAppHub({ paths, states: new AppStateRepo(db) });
  const killChildren = () => hub.killAllSync();
  killers.add(killChildren);
  let server: Deno.HttpServer<Deno.NetAddr> | undefined;
  try {
    const users = new UserRepo(db);
    const credentials = new SqliteCredentialStore(db);
    const registrations = new RegistrationRepo(db);
    const etHandler = createEtHandler({ config, users, credentials, hub });
    const wake = createStationWake({ config, db, credentials, etHandler });
    const app = createHttpApp({ config, wake, credentials, registrations });

    // 先に待ち受ける。ポートが使用中なら、アプリの子プロセスを起動する前に失敗させる。
    // 起動しきっていないアプリへのリクエストは、最初の走査が済むまでも、子が起動中の間も 503（app_unavailable）になる
    const port = options.port ?? config.port;
    try {
      server = Deno.serve({
        ...(options.hostname === undefined ? {} : { hostname: options.hostname }),
        port,
        onListen: () => {},
      }, app.fetch);
    } catch (e) {
      if (e instanceof Deno.errors.AddrInUse) throw new PortInUseError(port, e);
      throw e;
    }
    // READY が来ない子がいても、待つのは最長 30 秒
    await hub.start();
  } catch (e) {
    if (server !== undefined) await server.shutdown();
    await hub.stop();
    killers.delete(killChildren);
    db.close();
    throw e;
  }

  const listening = server;
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      // Ctrl-C は子にも届いて、子が終わる。片付けの途中で再起動されないよう、先に知らせる
      hub.beginStop();
      // 長引く接続があっても、猶予を過ぎたら待たない
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grace = new Promise<void>((resolve) => timer = setTimeout(resolve, SHUTDOWN_GRACE_MS));
      try {
        await Promise.race([listening.shutdown(), grace]);
      } finally {
        clearTimeout(timer);
      }
      await hub.stop();
      killers.delete(killChildren);
      db.close();
    })();
    return stopping;
  };

  log.info(`Station を起動しました: http://localhost:${listening.addr.port}（project: ${paths.root}）`);
  return { port: listening.addr.port, stop };
}

/** 書き込みが許されていないときの案内。deno task の権限は ./project だけに絞ってある */
function permissionHint(paths: ProjectPaths): string {
  return `project フォルダ（${paths.root}）に書き込めません。deno task start / dev が書き込めるのは ./project だけです。` +
    "別の場所を使うときは、deno run --allow-net --allow-read --allow-write=<場所> --allow-env --allow-run src/main.ts " +
    "のように直接起動してください";
}

function isPermissionError(e: unknown): boolean {
  return e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied;
}

/** コマンドとして起動したときの本体。終了コードを返す（SIGINT / SIGTERM で止まったら 0、起動に失敗したら 1） */
async function main(): Promise<number> {
  const paths = projectPaths();
  let firstSignalAt: number | undefined;
  const stopRequested = Promise.withResolvers<void>();
  const onSignal = (name: string) => () => {
    if (firstSignalAt !== undefined) {
      // 続けて届いたシグナルは数えない（Ctrl-C は子にも届き、deno --watch は SIGTERM も送ってくる）。
      // 片付けに手間取っているときに、少し間を置いてもう一度送れば抜けられる。
      // 抜ける前に子プロセスを SIGKILL する（イベントループを塞いだ子は親の消滅を見に来られず、取り残されるため）
      if (Date.now() - firstSignalAt < REPEATED_SIGNAL_MS) return;
      log.warn(`${name} をもう一度受け取りました。片付けを待たずに終了します`);
      for (const kill of killers) kill();
      Deno.exit(1);
    }
    firstSignalAt = Date.now();
    log.info(`${name} を受け取りました。終了します`);
    stopRequested.resolve();
  };
  Deno.addSignalListener("SIGINT", onSignal("SIGINT"));
  Deno.addSignalListener("SIGTERM", onSignal("SIGTERM"));

  let station: RunningStation;
  try {
    station = await startStation(paths);
  } catch (e) {
    if (e instanceof ConfigError || e instanceof PortInUseError) {
      log.error(e.message);
    } else if (isPermissionError(e)) {
      log.error(permissionHint(paths), e instanceof Error ? e.message : String(e));
    } else {
      log.error("Station を起動できませんでした", e);
    }
    return 1;
  }

  await stopRequested.promise;
  await station.stop();
  log.info("Station を止めました");
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
