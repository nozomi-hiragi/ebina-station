import { dirname, relative, resolve, SEPARATOR } from "@std/path";
import { DatabaseSync } from "node:sqlite";
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from "./schema.ts";
import { rowNumber } from "./row.ts";

/** ほかのプロセス（CLI など）が書き込み中でも待つ時間 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * SQLite を開いて PRAGMA を設定し、移行を済ませて返す。
 * path は ":memory:" でもよい（テスト用）。ファイルのときはフォルダが無ければ作り、権限を 0600 にする。
 * root（project フォルダ）を渡すと、root から DB ファイル（と WAL の補助ファイル）までにシンボリックリンクがあれば開かない。
 * リンクをたどると、project の外のファイルの権限を変えたり書き換えたりしてしまうため。
 * DB ファイルと既にある補助ファイルが、ほかの場所とハードリンクでつながっている（リンク数が 2 以上）ときも開かない（root が無くても確かめる）。
 * create: false を渡すと、DB ファイルが無いときは作らず DatabaseNotFoundError を投げる（読むだけの CLI 用）。
 */
export function openDatabase(path: string, options: { root?: string; create?: boolean } = {}): DatabaseSync {
  const inMemory = path === ":memory:";
  if (!inMemory) {
    if (options.root !== undefined) rejectSymlinks(options.root, path);
    rejectHardLinks(path);
    if (options.create === false) requireFile(path);
    else prepareFile(path);
  }

  const db = new DatabaseSync(path);
  try {
    // 別のプロセスが使っていても journal_mode の切り替えで失敗しないよう、busy_timeout を先に設定する
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

/** DB ファイルが無いことを表す。project の場所を間違えたときに、空の DB を作ってしまわないために使う */
export class DatabaseNotFoundError extends Error {
  readonly path: string;

  constructor(path: string, options?: ErrorOptions) {
    super(`DB ファイルが見つかりません: ${path}`, options);
    this.name = "DatabaseNotFoundError";
    this.path = path;
  }
}

function requireFile(path: string): void {
  try {
    if (Deno.statSync(path).isFile) return;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new DatabaseNotFoundError(path, { cause: e });
    throw e;
  }
  throw new DatabaseNotFoundError(path);
}

function isSymlink(path: string): boolean {
  try {
    return Deno.lstatSync(path).isSymlink;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/** root の中の、path までのフォルダ、path 自体、WAL の補助ファイルのどれかがシンボリックリンクなら投げる */
function rejectSymlinks(root: string, path: string): void {
  const absRoot = resolve(root);
  const absPath = resolve(path);
  const rel = relative(absRoot, absPath);
  if (rel.startsWith("..")) throw new Error(`DB ファイル ${absPath} が project フォルダ ${absRoot} の外にあります`);
  // project フォルダ自体がリンクなのは使う人の選んだことなので見ない。中だけを見る
  const targets: string[] = [];
  let current = absRoot;
  for (const part of rel.split(SEPARATOR)) {
    current = `${current}${SEPARATOR}${part}`;
    targets.push(current);
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) targets.push(absPath + suffix);
  for (const target of targets) {
    if (isSymlink(target)) {
      throw new Error(`${target} がシンボリックリンクのため、DB を開きません（project の外を書き換えないため）`);
    }
  }
}

/**
 * DB ファイルと、既にある WAL などの補助ファイルのリンク数が 2 以上なら投げる。
 * ハードリンクだと、chmod や SQLite の書き込みが、project の外の同じ中身のファイルにも効いてしまう。
 * リンク数を返さない OS（nlink が null）では確かめない
 */
function rejectHardLinks(path: string): void {
  for (const target of [path, ...["-wal", "-shm", "-journal"].map((suffix) => path + suffix)]) {
    let info: Deno.FileInfo;
    try {
      info = Deno.lstatSync(target);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw e;
    }
    if (info.isFile && info.nlink !== null && info.nlink > 1) {
      throw new Error(
        `${target} がハードリンク（リンク数 ${info.nlink}）のため、DB を開きません（project の外を書き換えないため）`,
      );
    }
  }
}

/** フォルダを作り、DB ファイルを 0600 で用意する。WAL の補助ファイルも同じ権限で作られる */
function prepareFile(path: string): void {
  Deno.mkdirSync(dirname(path), { recursive: true });
  try {
    Deno.writeFileSync(path, new Uint8Array(), { createNew: true, mode: 0o600 });
  } catch (e) {
    if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
    // 既にあるファイルは権限だけ締める。できなくても（他人の所有、Windows など）動作には影響しない
    try {
      Deno.chmodSync(path, 0o600);
    } catch {
      // 無視
    }
  }
}

function readVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  if (!row) throw new Error("DB の版を読めません");
  return rowNumber(row, "user_version");
}

/** user_version より新しい移行を順に適用する。Station と CLI が同時に開いても二重に適用しない */
export function migrate(db: DatabaseSync): void {
  if (readVersion(db) > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `DB の版（${readVersion(db)}）がこのプログラムの対応（${LATEST_SCHEMA_VERSION}）より新しいです。` +
        "新しい版の EbinaStation で作られた DB かもしれません",
    );
  }
  for (const migration of MIGRATIONS) {
    if (readVersion(db) >= migration.version) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      // 待っているあいだに別のプロセスが適用していたら何もしない
      if (readVersion(db) < migration.version) {
        db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${migration.version}`);
      }
      db.exec("COMMIT");
    } catch (e) {
      rollbackQuietly(db);
      throw e;
    }
  }
}

/** 巻き戻しの失敗（すでに SQLite が巻き戻していた場合など）で、元のエラーを隠さない */
function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // 無視
  }
}

/**
 * fn を 1 つのトランザクションで実行する。投げたら巻き戻す。
 * すでにトランザクションの中なら、そのまま fn を実行する（外側がまとめて確定・巻き戻す）。
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    rollbackQuietly(db);
    throw e;
  }
}
