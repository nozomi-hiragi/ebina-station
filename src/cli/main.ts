import { parseArgs } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import { ConfigError, loadStationConfig, type StationConfig } from "../config.ts";
import { SqliteCredentialStore } from "../db/credentials.ts";
import { inTransaction, openDatabase } from "../db/mod.ts";
import { RegistrationRepo } from "../db/registrations.ts";
import {
  type User,
  UserExistsError,
  UserNotFoundError,
  UserRepo,
  validateUserId,
  validateUserName,
} from "../db/users.ts";
import { projectPaths } from "../paths.ts";
import { renderQr } from "./qr.ts";

/** 使い方の誤り（終了コード 2） */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** 処理に失敗したとき（終了コード 1）。メッセージはそのまま端末に出す */
export class CliFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliFailure";
  }
}

/** コマンドが使う Station の設定と DB */
export interface CliContext {
  config: StationConfig;
  db: DatabaseSync;
  /** 登録トークンの時計（テスト用）。既定は Date.now */
  now?: () => number;
}

/** 発行した登録トークンと、パスキー登録の URL */
export interface IssuedRegistration {
  user: User;
  /** 平文のトークン。DB には残らない */
  token: string;
  code: string;
  expiresAt: number;
  url: string;
}

/** 登録 URL: `<frontURL>/register?server=<serverURL>&token=<token>`。code があれば `&code=` を足す */
export function registrationUrl(config: StationConfig, token: string, code?: string): string {
  const base = `${config.frontURL}/register?server=${encodeURIComponent(config.serverURL)}&token=${token}`;
  return code === undefined ? base : `${base}&code=${code}`;
}

function issue(ctx: CliContext, user: User, withCode: boolean): IssuedRegistration {
  const { token, code, expiresAt } = new RegistrationRepo(ctx.db, ctx.now).issue(user.id);
  return { user, token, code, expiresAt, url: registrationUrl(ctx.config, token, withCode ? code : undefined) };
}

/** ユーザーを作り、登録トークンを発行する。どちらかが失敗したら、ユーザーも作らない */
export function addUser(
  ctx: CliContext,
  id: string,
  name: string,
  options: { withCode?: boolean } = {},
): IssuedRegistration {
  return inTransaction(ctx.db, () => issue(ctx, new UserRepo(ctx.db).create(id, name), options.withCode === true));
}

/** 既存のユーザーに登録トークンを発行し直す。ユーザーがいなければ UserNotFoundError */
export function reissueToken(ctx: CliContext, id: string, options: { withCode?: boolean } = {}): IssuedRegistration {
  const user = new UserRepo(ctx.db).get(id);
  if (!user) throw new UserNotFoundError(id);
  return issue(ctx, user, options.withCode === true);
}

export function listUsers(db: DatabaseSync): { user: User; passkeys: number }[] {
  const credentials = new SqliteCredentialStore(db);
  return new UserRepo(db).list().map((user) => ({ user, passkeys: credentials.listByUser(user.id).length }));
}

/** ユーザーを消す（パスキーと登録トークンも消える）。消したら true */
export function removeUser(db: DatabaseSync, id: string): boolean {
  return new UserRepo(db).remove(id);
}

/** 入出力。テストでは差し替える */
export interface CliEnv {
  /** project フォルダ。省略時は環境変数 EBINA_PROJECT_DIR、無ければ ./project */
  projectRoot?: string;
  /** 1 行出す（標準出力） */
  out(text: string): void;
  /** 1 行出す（標準エラー） */
  err(text: string): void;
  /** 「はい」なら true */
  confirm(message: string): boolean | Promise<boolean>;
  renderQr(url: string): Promise<string>;
  now?: () => number;
}

const USAGE = `使い方: deno task user <サブコマンド>

  add <ID> <名前> [--with-code]   ユーザーを作り、パスキーの登録 URL・QR・確認コードを出す
  token <ID> [--with-code]        既存のユーザーに登録 URL を発行し直す（別のパスキーを足すとき）
  list                            ユーザーの一覧
  remove <ID> [--yes]             ユーザーを消す（パスキーと登録トークンも消える）

  --with-code  確認コードも登録 URL に含める（既定は含めない）
  --yes        確認を求めずに消す

名前に空白を含むときは引用符で囲んでください。`;

type Flag = "with-code" | "yes";

/** 引数を読む。この command で使えない印や、数の合わない引数は UsageError */
function parseCommandArgs(
  args: readonly string[],
  flags: readonly Flag[],
  positionalCount: number,
  positionalUsage: string,
): { positionals: string[]; flags: Record<Flag, boolean> } {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: { "with-code": { type: "boolean" }, yes: { type: "boolean", short: "y" } },
    });
  } catch (e) {
    throw new UsageError(`引数が正しくありません: ${e instanceof Error ? e.message : String(e)}`);
  }
  const given: Record<Flag, boolean> = { "with-code": false, yes: false };
  for (const flag of ["with-code", "yes"] as const) {
    if (parsed.values[flag] === true) {
      if (!flags.includes(flag)) throw new UsageError(`--${flag} はこのサブコマンドでは使えません`);
      given[flag] = true;
    }
  }
  if (parsed.positionals.length !== positionalCount) {
    throw new UsageError(`引数の数が合いません。${positionalUsage}`);
  }
  return { positionals: parsed.positionals, flags: given };
}

/** 文字の表示幅（全角を 2 として数える）。一覧の桁をそろえるための簡易な計算 */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    const wide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

function padEndWidth(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 端末のローカル時刻で `2026-10-21 16:30` の形にする */
function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${
    pad2(d.getMinutes())
  }`;
}

function checkUserInput(id: string, name?: string): void {
  const problem = validateUserId(id) ?? (name === undefined ? null : validateUserName(name));
  if (problem) throw new UsageError(problem);
}

async function printIssued(env: CliEnv, issued: IssuedRegistration): Promise<void> {
  env.out("登録 URL（15 分以内に、1 回だけ使えます）:");
  env.out(issued.url);
  env.out("");
  env.out((await env.renderQr(issued.url)).trimEnd());
  env.out("");
  env.out(`確認コード: ${issued.code}`);
  env.out(`有効期限: ${formatDateTime(issued.expiresAt)}`);
}

/** station.json を読んで DB を開き、fn を実行して DB を閉じる */
async function withContext<T>(env: CliEnv, fn: (ctx: CliContext) => Promise<T>): Promise<T> {
  const paths = projectPaths(env.projectRoot);
  const config = await loadStationConfig(paths.config);
  const db = openDatabase(paths.db);
  try {
    return await fn({ config, db, now: env.now });
  } finally {
    db.close();
  }
}

async function withDatabase<T>(env: CliEnv, fn: (db: DatabaseSync) => Promise<T>): Promise<T> {
  const db = openDatabase(projectPaths(env.projectRoot).db);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

async function runAdd(args: readonly string[], env: CliEnv): Promise<number> {
  const parsed = parseCommandArgs(args, ["with-code"], 2, "add <ID> <名前> [--with-code]");
  const [id, name] = parsed.positionals;
  checkUserInput(id, name);
  return await withContext(env, async (ctx) => {
    const issued = addUser(ctx, id, name, { withCode: parsed.flags["with-code"] });
    env.out(`ユーザー ${issued.user.id}（${issued.user.name}）を作成しました。`);
    env.out("");
    await printIssued(env, issued);
    return 0;
  });
}

async function runToken(args: readonly string[], env: CliEnv): Promise<number> {
  const parsed = parseCommandArgs(args, ["with-code"], 1, "token <ID> [--with-code]");
  const [id] = parsed.positionals;
  checkUserInput(id);
  return await withContext(env, async (ctx) => {
    const issued = reissueToken(ctx, id, { withCode: parsed.flags["with-code"] });
    env.out(`ユーザー ${issued.user.id}（${issued.user.name}）の登録 URL を発行しました。`);
    env.out("");
    await printIssued(env, issued);
    return 0;
  });
}

async function runList(args: readonly string[], env: CliEnv): Promise<number> {
  parseCommandArgs(args, [], 0, "list");
  return await withDatabase(env, (db) => {
    const rows = listUsers(db);
    if (rows.length === 0) {
      env.out("ユーザーはいません");
      return Promise.resolve(0);
    }
    const idWidth = Math.max(displayWidth("ID"), ...rows.map((r) => displayWidth(r.user.id)));
    const nameWidth = Math.max(displayWidth("名前"), ...rows.map((r) => displayWidth(r.user.name)));
    env.out(`${padEndWidth("ID", idWidth)}  ${padEndWidth("名前", nameWidth)}  パスキー`);
    for (const { user, passkeys } of rows) {
      env.out(`${padEndWidth(user.id, idWidth)}  ${padEndWidth(user.name, nameWidth)}  ${passkeys}`);
    }
    return Promise.resolve(0);
  });
}

async function runRemove(args: readonly string[], env: CliEnv): Promise<number> {
  const parsed = parseCommandArgs(args, ["yes"], 1, "remove <ID> [--yes]");
  const [id] = parsed.positionals;
  checkUserInput(id);
  return await withDatabase(env, async (db) => {
    const user = new UserRepo(db).get(id);
    if (!user) throw new UserNotFoundError(id);
    if (!parsed.flags.yes) {
      const passkeys = new SqliteCredentialStore(db).listByUser(id).length;
      const ok = await env.confirm(
        `ユーザー ${user.id}（${user.name}）を消します。パスキー ${passkeys} 件と登録トークンも消えます。よろしいですか?`,
      );
      if (!ok) throw new CliFailure("中止しました（確認なしで消すには --yes を付けます）");
    }
    removeUser(db, id);
    env.out(`ユーザー ${user.id}（${user.name}）を消しました。`);
    env.out("動いている Station では、このユーザーのログインは次のリクエストから使えなくなります。");
    return 0;
  });
}

/**
 * `deno task user` の本体。終了コードを返す（成功 0、使い方の誤り 2、それ以外の失敗 1）。
 * args は `Deno.args`（サブコマンドから）
 */
export async function runCli(args: readonly string[], env: CliEnv): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (command === "help" || command === "--help" || command === "-h") {
      env.out(USAGE);
      return 0;
    }
    if (rest.includes("--help") || rest.includes("-h")) {
      env.out(USAGE);
      return 0;
    }
    switch (command) {
      case "add":
        return await runAdd(rest, env);
      case "token":
        return await runToken(rest, env);
      case "list":
        return await runList(rest, env);
      case "remove":
        return await runRemove(rest, env);
      case undefined:
        throw new UsageError("サブコマンドを指定してください");
      default:
        throw new UsageError(`知らないサブコマンドです: ${command}`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      env.err(`エラー: ${e.message}`);
      env.err("");
      env.err(USAGE);
      return 2;
    }
    if (
      e instanceof CliFailure || e instanceof ConfigError || e instanceof UserExistsError ||
      e instanceof UserNotFoundError
    ) {
      env.err(`エラー: ${e.message}`);
      return 1;
    }
    if (e instanceof Deno.errors.NotCapable) {
      env.err(`エラー: 権限が足りません: ${e.message}`);
      env.err(
        "deno task user が書き込めるのは ./project だけです。別の場所の project を使うときは、" +
          "EBINA_PROJECT_DIR を指定して deno run --allow-read --allow-write=<場所> --allow-env src/cli/main.ts " +
          "<サブコマンド> のように直接実行してください",
      );
      return 1;
    }
    env.err(`エラー: 予期しない失敗です: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

function terminalEnv(): CliEnv {
  return {
    out: (text) => console.log(text),
    err: (text) => console.error(text),
    confirm: (message) => {
      const answer = prompt(`${message} [y/N]`);
      return answer !== null && /^(y|yes)$/i.test(answer.trim());
    },
    renderQr,
  };
}

if (import.meta.main) {
  Deno.exit(await runCli(Deno.args, terminalEnv()));
}
