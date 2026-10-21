import { dirname } from "@std/path";
import { DatabaseSync } from "node:sqlite";
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from "./schema.ts";
import { rowNumber } from "./row.ts";

/** ほかのプロセス（CLI など）が書き込み中でも待つ時間 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * SQLite を開いて PRAGMA を設定し、移行を済ませて返す。
 * path は ":memory:" でもよい（テスト用）。ファイルのときはフォルダが無ければ作り、権限を 0600 にする。
 */
export function openDatabase(path: string): DatabaseSync {
  const inMemory = path === ":memory:";
  if (!inMemory) prepareFile(path);

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
