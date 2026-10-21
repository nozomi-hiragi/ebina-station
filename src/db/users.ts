import type { DatabaseSync, StatementSync } from "node:sqlite";
import { type Row, rowNumber, rowString } from "./row.ts";

export interface User {
  id: string;
  name: string;
  /** 作成時刻（エポックミリ秒） */
  createdAt: number;
}

export class UserExistsError extends Error {
  constructor(id: string) {
    super(`ユーザー ${id} はすでにあります`);
    this.name = "UserExistsError";
  }
}

export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`ユーザー ${id} が見つかりません`);
    this.name = "UserNotFoundError";
  }
}

const USER_ID_MAX = 64;
const USER_NAME_MAX = 64;

/** ユーザー ID の検査。エラーの日本語メッセージか、問題なければ null */
export function validateUserId(id: string): string | null {
  if (typeof id !== "string" || id.length === 0) return "ユーザー ID を入力してください";
  if (id.length > USER_ID_MAX) return `ユーザー ID は ${USER_ID_MAX} 文字以内にしてください`;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return "ユーザー ID に使えるのは、英数字と . _ - だけです";
  return null;
}

function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 名前の検査。前後の空白を除いて 1〜64 文字（コードポイント数）。改行などの制御文字は使えない */
export function validateUserName(name: string): string | null {
  if (typeof name !== "string") return "名前を入力してください";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "名前を入力してください";
  if ([...trimmed].length > USER_NAME_MAX) return `名前は ${USER_NAME_MAX} 文字以内にしてください`;
  if (hasControlChar(trimmed)) return "名前に改行や制御文字を含めることはできません";
  return null;
}

function toUser(row: Row): User {
  return { id: rowString(row, "id"), name: rowString(row, "name"), createdAt: rowNumber(row, "created_at") };
}

export class UserRepo {
  readonly #insert: StatementSync;
  readonly #get: StatementSync;
  readonly #list: StatementSync;
  readonly #remove: StatementSync;

  constructor(db: DatabaseSync) {
    this.#insert = db.prepare("INSERT INTO users (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING");
    this.#get = db.prepare("SELECT id, name, created_at FROM users WHERE id = ?");
    this.#list = db.prepare("SELECT id, name, created_at FROM users ORDER BY created_at, id");
    this.#remove = db.prepare("DELETE FROM users WHERE id = ?");
  }

  /** ユーザーを作る。ID の重複は UserExistsError、ID・名前の形式が不正なら Error。名前は前後の空白を除いて保存する */
  create(id: string, name: string): User {
    const problem = validateUserId(id) ?? validateUserName(name);
    if (problem) throw new Error(problem);
    const user: User = { id, name: name.trim(), createdAt: Date.now() };
    const result = this.#insert.run(user.id, user.name, user.createdAt);
    if (Number(result.changes) === 0) throw new UserExistsError(id);
    return user;
  }

  get(id: string): User | undefined {
    const row = this.#get.get(id);
    return row && toUser(row);
  }

  /** 作成の古い順 */
  list(): User[] {
    return this.#list.all().map(toUser);
  }

  /** ユーザーを消す。パスキーと登録トークンも一緒に消える。消したら true */
  remove(id: string): boolean {
    return Number(this.#remove.run(id).changes) > 0;
  }
}
