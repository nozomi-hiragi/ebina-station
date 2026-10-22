import { fromFileUrl, SEPARATOR, toFileUrl } from "@std/path";
import { log } from "../log.ts";
import { symlinkInChain, symlinkProblem } from "./links.ts";
import type { AppStatus } from "./types.ts";

/** runner/runner.ts が待ち受けを始めたときに標準出力へ出す 1 行 */
export const READY_LINE = "EBINA_READY";
/** 待ち受けの確認に使うヘッダー。値は Station が選ぶ nonce（runner/runner.ts と同じ） */
export const PROBE_HEADER = "ebina-runner-probe";
/** 確認への応答のヘッダー。HMAC-SHA256(key=トークン, nonce) の hex */
export const PROOF_HEADER = "ebina-runner-proof";

/** HMAC-SHA256(key=token, nonce) を hex で返す */
export async function probeProof(token: string, nonce: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(nonce)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 長さの違いも含めて、時間をかけずに比べる */
function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}

const DEFAULT_RUNNER_PATH = fromFileUrl(new URL("../../runner/runner.ts", import.meta.url));
const DEFAULT_CONFIG_PATH = fromFileUrl(new URL("../../deno.json", import.meta.url));

/** 1 行の長さの上限。改行の無い出力で溜め込まないよう、超えたら区切る */
const LINE_MAX = 8192;

export type LogStream = "stdout" | "stderr" | "station";

/** アプリのログの 1 行。station は Station 自身が足す起動・終了の記録 */
export interface AppLogLine {
  /** epoch ミリ秒 */
  time: number;
  stream: LogStream;
  text: string;
}

export interface SupervisorOptions {
  /** アプリ名（アプリ名の形式であること） */
  name: string;
  /** apps/<名前> の絶対パス */
  appDir: string;
  /** data/apps/<名前> の絶対パス。起動のたびに作る */
  dataDir: string;
  /** entry の絶対パス */
  entry: string;
  /** project フォルダ。渡すと、そこから appDir・dataDir までの途中のシンボリックリンクも拒む */
  projectRoot?: string;
  /** runner/runner.ts の絶対パス。省略するとリポジトリのもの */
  runnerPath?: string;
  /** deno.json の絶対パス。省略するとリポジトリのもの */
  configPath?: string;
  /** 起動から EBINA_READY までの猶予（ミリ秒）。既定 30 秒 */
  startTimeoutMs?: number;
  /** SIGTERM から SIGKILL までの猶予（ミリ秒）。既定 5 秒 */
  stopTimeoutMs?: number;
  /** 再起動の間隔。1 回目の落ち方 baseMs、以降は倍々で maxMs まで。既定 1 秒〜30 秒 */
  restartBaseMs?: number;
  restartMaxMs?: number;
  /** この時間のうちに crashLimit 回落ちたら異常にして止める。既定 10 分・5 回 */
  crashWindowMs?: number;
  crashLimit?: number;
  /** 持つログの行数。既定 500 */
  maxLogLines?: number;
}

type LaunchResult =
  | { kind: "stopped" }
  | { kind: "start-timeout" }
  | { kind: "exited"; description: string }
  /** 権限を安全に渡せないため、起動せずに異常にする（再起動しても変わらない） */
  | { kind: "refused"; message: string };

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** 空きポートを 1 つ選ぶ（選んで閉じるので、起動までの間に取られたら子が落ちて再起動になる） */
function pickFreePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    return (listener.addr as Deno.NetAddr).port;
  } finally {
    listener.close();
  }
}

/** 待つ。wake を呼ぶと途中で終わる */
function interruptibleSleep(ms: number): { done: Promise<void>; wake: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
    timer = setTimeout(resolve, ms);
  });
  return {
    done,
    wake: () => {
      clearTimeout(timer);
      finish();
    },
  };
}

/** promise を ms まで待つ。時間切れなら false */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true, () => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function describeExit(status: Deno.CommandStatus): string {
  return status.signal !== null ? `シグナル ${status.signal} で終了` : `終了コード ${status.code}`;
}

/**
 * 埋め込みアプリの子プロセス 1 つを起動して見張る。
 * 落ちたら間隔を延ばしながら再起動し、続けて落ちたら異常にして止める。
 */
export class AppSupervisor {
  readonly #options: Required<Omit<SupervisorOptions, "projectRoot">> & Pick<SupervisorOptions, "projectRoot">;
  #status: AppStatus = "stopped";
  #error: string | undefined;
  #logs: AppLogLine[] = [];
  #child: Deno.ChildProcess | undefined;
  #port: number | undefined;
  #token: string | undefined;
  #client: Deno.HttpClient | undefined;
  #stopRequested = false;
  #loop: Promise<void> | undefined;
  #crashes: number[] = [];
  #sleeper: { wake: () => void } | undefined;
  #firstAttempt: Promise<void> = Promise.resolve();
  #settleFirstAttempt: () => void = () => {};

  constructor(options: SupervisorOptions) {
    this.#options = {
      name: options.name,
      appDir: options.appDir,
      dataDir: options.dataDir,
      entry: options.entry,
      projectRoot: options.projectRoot,
      runnerPath: options.runnerPath ?? DEFAULT_RUNNER_PATH,
      configPath: options.configPath ?? DEFAULT_CONFIG_PATH,
      startTimeoutMs: options.startTimeoutMs ?? 30_000,
      stopTimeoutMs: options.stopTimeoutMs ?? 5_000,
      restartBaseMs: options.restartBaseMs ?? 1_000,
      restartMaxMs: options.restartMaxMs ?? 30_000,
      crashWindowMs: options.crashWindowMs ?? 10 * 60_000,
      crashLimit: options.crashLimit ?? 5,
      maxLogLines: options.maxLogLines ?? 500,
    };
  }

  get status(): AppStatus {
    return this.#status;
  }

  /** status が error のときの理由 */
  get error(): string | undefined {
    return this.#error;
  }

  /** 動いている子プロセスの pid。動いていなければ undefined */
  get pid(): number | undefined {
    return this.#child?.pid;
  }

  /**
   * 子プロセスの待ち受け先。running のときだけ返す。
   * client は、環境変数の HTTP_PROXY があっても必ずその子へ直接つなぐ fetch 用のもの（トークンをプロキシへ送らないため）
   */
  target(): { port: number; token: string; client: Deno.HttpClient } | undefined {
    if (this.#status !== "running" || this.#port === undefined || this.#token === undefined) return undefined;
    if (this.#client === undefined) return undefined;
    return { port: this.#port, token: this.#token, client: this.#client };
  }

  /** 最新のログ（古い順） */
  logs(): AppLogLine[] {
    return [...this.#logs];
  }

  /**
   * 起動を始める。最初の起動が running になるか、失敗するまで待つ（最長 startTimeoutMs）。
   * 失敗しても再起動は裏で続き、この Promise は投げない。起動中に呼んでも何もしない。
   */
  start(): Promise<void> {
    if (this.#loop !== undefined) return this.#firstAttempt;
    // --allow-read などは , で区切るため、, を含むパスは権限を正しく指定できない（意図しない場所を許してしまう）
    if ([this.#options.appDir, this.#options.dataDir].some((path) => path.includes(","))) {
      this.#fail("アプリのフォルダのパスに , が含まれているため、権限を正しく指定できず起動できません");
      return Promise.resolve();
    }
    this.#stopRequested = false;
    this.#crashes = [];
    this.#error = undefined;
    this.#status = "starting";
    this.#firstAttempt = new Promise<void>((resolve) => {
      this.#settleFirstAttempt = resolve;
    });
    this.#loop = this.#run().finally(() => {
      this.#loop = undefined;
    });
    return this.#firstAttempt;
  }

  /** 止め始めたことを知らせる。以後は子が終わっても再起動しない（止まるのを待たない）。最初の起動の待ちも解く */
  beginStop(): void {
    this.#stopRequested = true;
    this.#sleeper?.wake();
    this.#settleFirstAttempt();
  }

  /** 子プロセスに同期で SIGKILL を送る。終了を待たず、再起動もしない（Station を強制終了する直前用） */
  killSync(): void {
    this.#stopRequested = true;
    try {
      this.#child?.kill("SIGKILL");
    } catch {
      // すでに終わっている
    }
  }

  /** 子プロセスを止める（SIGTERM、猶予のあと SIGKILL）。止まるまで待つ */
  async stop(): Promise<void> {
    this.#stopRequested = true;
    this.#sleeper?.wake();
    const child = this.#child;
    if (child !== undefined) await this.#terminate(child);
    await this.#loop;
    if (this.#status !== "stopped") this.#status = "stopped";
    this.#error = undefined;
  }

  async #run(): Promise<void> {
    try {
      while (!this.#stopRequested) {
        const result = await this.#launch();
        if (result.kind === "stopped" || this.#stopRequested) return;
        if (result.kind === "refused") {
          this.#fail(result.message);
          return;
        }
        if (result.kind === "start-timeout") {
          this.#fail(`起動から ${this.#options.startTimeoutMs / 1000} 秒たっても準備ができなかったため止めました`);
          return;
        }

        const now = Date.now();
        this.#crashes.push(now);
        this.#crashes = this.#crashes.filter((time) => now - time < this.#options.crashWindowMs);
        if (this.#crashes.length >= this.#options.crashLimit) {
          const minutes = Math.round(this.#options.crashWindowMs / 60_000);
          this.#fail(
            `${minutes} 分のうちに ${this.#crashes.length} 回終了したため止めました（最後は${result.description}）`,
          );
          return;
        }
        const delay = Math.min(
          this.#options.restartBaseMs * 2 ** (this.#crashes.length - 1),
          this.#options.restartMaxMs,
        );
        this.#note(`${delay} ミリ秒後に再起動します`);
        // 最初の起動が終わった（落ちて、再起動を待つ状態になった）
        this.#settleFirstAttempt();
        log.warn(
          `アプリ ${this.#options.name} が終了しました（${result.description}）。${delay} ミリ秒後に再起動します`,
        );
        const sleeper = interruptibleSleep(delay);
        this.#sleeper = sleeper;
        await sleeper.done;
        this.#sleeper = undefined;
      }
    } catch (error) {
      this.#fail(`予期しないエラーで止まりました: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.#status !== "error") this.#status = "stopped";
      this.#settleFirstAttempt();
    }
  }

  #fail(message: string): void {
    this.#status = "error";
    this.#error = message;
    this.#note(message);
    log.error(`アプリ ${this.#options.name}: ${message}`);
  }

  #note(text: string): void {
    this.#push("station", text);
  }

  #push(stream: LogStream, text: string): void {
    this.#logs.push({ time: Date.now(), stream, text });
    const extra = this.#logs.length - this.#options.maxLogLines;
    if (extra > 0) this.#logs.splice(0, extra);
  }

  /** 子プロセスを 1 つ起動し、終わるまで待つ */
  async #launch(): Promise<LaunchResult> {
    const options = this.#options;
    const token = randomToken();
    let port: number;
    let env: Record<string, string>;
    let appDir: string;
    let dataDir: string;
    let entry: string;
    try {
      // project/apps や project/data/apps がリンクだと、project の外に権限を渡してしまう。作る前に確かめる
      if (options.projectRoot !== undefined) {
        for (const [dir, label] of [[options.appDir, "アプリのフォルダ"], [options.dataDir, "データフォルダ"]]) {
          const problem = await symlinkInChain(options.projectRoot, dir, label);
          if (problem !== null) return this.#refused(problem);
        }
      }
      await Deno.mkdir(options.dataDir, { recursive: true, mode: 0o700 });
      // 権限を渡すフォルダに、置いたときから入っているシンボリックリンクがあると、リンクの先を権限の外から読めてしまう。
      // 走査のあとに置かれた場合に備え、起動のたびに確かめる
      for (const [dir, label] of [[options.appDir, "アプリのフォルダ"], [options.dataDir, "データフォルダ"]]) {
        const problem = await symlinkProblem(dir, label);
        if (problem !== null) return this.#refused(problem);
      }
      // 既にあるデータフォルダも、ほかのユーザーから読めないよう締める（リンクでないと確かめたあと）。できなくても動作には影響しない
      try {
        await Deno.chmod(options.dataDir, 0o700);
      } catch {
        // 他人の所有など
      }
      // 権限には、リンクを解決したパスを渡す
      appDir = await Deno.realPath(options.appDir);
      dataDir = await Deno.realPath(options.dataDir);
      entry = await Deno.realPath(options.entry);
      if (!entry.startsWith(appDir + SEPARATOR)) return this.#refused("entry がアプリのフォルダの外を指しています");
      if ([appDir, dataDir].some((path) => path.includes(","))) {
        return this.#refused("アプリのフォルダのパスに , が含まれているため、権限を正しく指定できず起動できません");
      }
      port = pickFreePort();
      env = { EBINA_PORT: String(port), EBINA_APP_TOKEN: token, EBINA_DATA_DIR: dataDir };
      // Deno が動くのに要るものだけを引き継ぐ
      for (const key of ["HOME", "DENO_DIR", "XDG_CACHE_HOME", "PATH"]) {
        const value = Deno.env.get(key);
        if (value !== undefined) env[key] = value;
      }
    } catch (error) {
      return this.#launchFailed(`起動の準備に失敗しました: ${error instanceof Error ? error.message : error}`);
    }
    if (this.#stopRequested) return { kind: "stopped" };

    let child: Deno.ChildProcess;
    try {
      child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-prompt",
          `--config=${options.configPath}`,
          // モジュールは Station のキャッシュと deno.lock にあるものだけ使う。
          // 取得（外への通信）も、deno.lock の書き換えもさせない
          "--frozen",
          "--cached-only",
          "--allow-env=EBINA_PORT,EBINA_APP_TOKEN,EBINA_DATA_DIR",
          `--allow-net=127.0.0.1:${port}`,
          `--allow-read=${appDir},${dataDir}`,
          `--allow-write=${dataDir}`,
          options.runnerPath,
          toFileUrl(entry).href,
        ],
        clearEnv: true,
        env,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
    } catch (error) {
      return this.#launchFailed(`子プロセスを起動できません: ${error instanceof Error ? error.message : error}`);
    }

    this.#child = child;
    this.#port = port;
    this.#token = token;
    this.#client = Deno.createHttpClient({ proxy: { transport: "tcp", hostname: "127.0.0.1", port } });
    this.#status = "starting";
    this.#note(`起動しました（pid ${child.pid}、ポート ${port}）`);

    // アプリが Ebina-App-Token を出力しても、記録にもログにも残さない。長い行を区切る前に伏せる（#pump）
    const redact = (text: string) => text.replaceAll(token, "(token)");
    const onLine = (stream: LogStream, text: string) => {
      this.#push(stream, text);
      // runner の合図の行はログに出さない。起動済みかどうかは、行ではなく runner への確認で決める（下の #confirmReady）
      if (stream === "stdout" && text === READY_LINE) return;
      // 起動に失敗した理由やアプリの例外は標準エラーに出る。画面ができるまで、Station のログでも見られるようにする
      if (stream === "stderr") log.warn(`アプリ ${options.name}: ${text}`);
      else log.info(`アプリ ${options.name}: ${text}`);
    };
    const pumps = [
      this.#pump(child.stdout, "stdout", onLine, redact, token.length),
      this.#pump(child.stderr, "stderr", onLine, redact, token.length),
    ];
    // アプリの出力は合図の行とつながることがあるので、標準出力の行を待たずに、起動した直後から確かめ続ける
    void this.#confirmReady(child, port, token);

    let timedOut = false;
    const timer = setTimeout(() => {
      if (this.#status !== "starting" || this.#child !== child) return;
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // すでに終わっている
      }
    }, options.startTimeoutMs);

    let status: Deno.CommandStatus;
    try {
      status = await child.status;
    } finally {
      clearTimeout(timer);
    }
    // 出力を読み切る（孫プロセスが出力を握っていても、止まらないよう待つのは少しだけ）
    await settledWithin(Promise.all(pumps), 2_000);

    this.#child = undefined;
    this.#port = undefined;
    this.#token = undefined;
    this.#client?.close();
    this.#client = undefined;
    const description = describeExit(status);
    this.#note(`終了しました（${description}）`);
    if (this.#stopRequested) return { kind: "stopped" };
    this.#status = "starting";
    return timedOut ? { kind: "start-timeout" } : { kind: "exited", description };
  }

  /**
   * runner が待ち受けていることを、nonce の確認で確かめてから running にする。
   * 確認はトークンを送らない。runner は HMAC-SHA256(key=トークン, nonce) を返し、合ったときだけ running にする
   * （ポートを先に取った別のプロセスには、トークンを渡さず、なりすましも通さない）。
   * 子が替わるか starting でなくなるまで（起動の時間切れで子が止められるまで）確かめ続ける
   */
  async #confirmReady(child: Deno.ChildProcess, port: number, token: string): Promise<void> {
    const client = this.#client;
    if (client === undefined) return;
    for (;;) {
      if (this.#child !== child || this.#status !== "starting") return;
      try {
        const nonce = randomToken();
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          headers: { [PROBE_HEADER]: nonce },
          client,
          signal: AbortSignal.timeout(2_000),
        });
        await res.body?.cancel();
        const proof = res.headers.get(PROOF_HEADER);
        if (res.status === 204 && proof !== null && constantTimeEqual(proof, await probeProof(token, nonce))) {
          if (this.#child === child && this.#status === "starting") {
            this.#status = "running";
            this.#settleFirstAttempt();
          }
          return;
        }
      } catch {
        // まだ待ち受けていない。少し待ってやり直す
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  #refused(message: string): LaunchResult {
    return this.#stopRequested ? { kind: "stopped" } : { kind: "refused", message };
  }

  #launchFailed(description: string): LaunchResult {
    this.#note(description);
    return this.#stopRequested ? { kind: "stopped" } : { kind: "exited", description };
  }

  /**
   * 出力を行ごとに読む。redact（秘密を伏せる）は区切る前の文字列に掛ける。
   * 改行の来ないまま溜まった分を先に出すときは、末尾の secretLength - 1 文字を残し、届きかけの秘密が区切りで割れないようにする
   */
  async #pump(
    stream: ReadableStream<Uint8Array>,
    name: LogStream,
    onLine: (stream: LogStream, text: string) => void,
    redact: (text: string) => string = (text) => text,
    secretLength = 0,
  ): Promise<void> {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    const keep = Math.max(0, secretLength - 1);
    // 長すぎる行は LINE_MAX ごとに区切って出す
    const emit = (line: string) => {
      let rest = redact(line);
      while (rest.length > LINE_MAX) {
        onLine(name, rest.slice(0, LINE_MAX));
        rest = rest.slice(LINE_MAX);
      }
      onLine(name, rest);
    };
    let pending = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += value;
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          emit(pending.slice(0, newline).replace(/\r$/, ""));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf("\n");
        }
        // 改行が来ないまま溜まった分も、上限を超えたら先に出す（伏せてから。末尾の keep 文字は次に回す）
        if (pending.length > LINE_MAX + keep) pending = redact(pending);
        while (pending.length > LINE_MAX + keep) {
          onLine(name, pending.slice(0, LINE_MAX));
          pending = pending.slice(LINE_MAX);
        }
      }
      if (pending.length > 0) emit(pending);
    } catch {
      // 読み取りの失敗（強制終了など）は、終了の記録で足りる
    } finally {
      reader.releaseLock();
    }
  }

  async #terminate(child: Deno.ChildProcess): Promise<void> {
    try {
      child.kill("SIGTERM");
    } catch {
      // すでに終わっている
    }
    if (await settledWithin(child.status, this.#options.stopTimeoutMs)) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // すでに終わっている
    }
    await child.status;
  }
}
