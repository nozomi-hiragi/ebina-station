import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { inTransaction } from "../db/mod.ts";
import { type Row, rowNumber, rowOptionalString, rowString } from "../db/row.ts";
import { type User, UserNotFoundError } from "./users.ts";

/** 登録トークンの有効期間 */
export const REGISTRATION_TTL_MS = 15 * 60 * 1000;
/** 確認コードを間違えてよい回数。この回数に達するとトークンは無効になる */
export const MAX_CODE_ATTEMPTS = 5;
/** 長すぎる入力は DB を引かずに無効として扱う（本物のトークンは 43 文字） */
const MAX_TOKEN_LENGTH = 256;

export type CodeCheck = { status: "ok" } | { status: "wrong"; remaining: number } | { status: "invalid" };

/** DB にはトークンそのものではなく、この SHA-256（base64url）だけを保存する */
function sha256(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** 外から来たトークンのハッシュ。文字列でない・空・長すぎるものは undefined（DB を引かずに無効とする） */
function hashInput(token: unknown): string | undefined {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return undefined;
  return sha256(token);
}

function sameCode(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 登録トークン（パスキー登録用の使い捨てリンク）の発行と照合 */
export class RegistrationRepo {
  readonly #db: DatabaseSync;
  readonly #now: () => number;
  readonly #userExists: StatementSync;
  readonly #purge: StatementSync;
  readonly #revokeUnused: StatementSync;
  readonly #insert: StatementSync;
  readonly #getValid: StatementSync;
  readonly #getForCheck: StatementSync;
  readonly #countWrong: StatementSync;
  readonly #setChallenge: StatementSync;
  readonly #clearChallenge: StatementSync;
  readonly #markUsed: StatementSync;

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
    this.#userExists = db.prepare("SELECT 1 AS found FROM users WHERE id = ?");
    this.#purge = db.prepare("DELETE FROM registration_tokens WHERE used = 1 OR expires_at <= ?");
    this.#revokeUnused = db.prepare("DELETE FROM registration_tokens WHERE user_id = ? AND used = 0");
    this.#insert = db.prepare(
      "INSERT INTO registration_tokens (token_hash, user_id, code, expires_at) VALUES (?, ?, ?, ?)",
    );
    this.#getValid = db.prepare(
      `SELECT u.id AS id, u.name AS name, u.created_at AS created_at, t.challenge AS challenge
       FROM registration_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.used = 0 AND t.expires_at > ?`,
    );
    this.#getForCheck = db.prepare(
      "SELECT code FROM registration_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?",
    );
    // 間違いの記録は 1 つの UPDATE で行う（回数の数え落としを防ぐ）。上限に達したら同時に使用済みにする
    this.#countWrong = db.prepare(
      `UPDATE registration_tokens
       SET attempts = attempts + 1, used = CASE WHEN attempts + 1 >= ? THEN 1 ELSE used END
       WHERE token_hash = ? AND used = 0
       RETURNING attempts`,
    );
    this.#setChallenge = db.prepare("UPDATE registration_tokens SET challenge = ? WHERE token_hash = ? AND used = 0");
    this.#clearChallenge = db.prepare(
      "UPDATE registration_tokens SET challenge = NULL WHERE token_hash = ? AND used = 0",
    );
    this.#markUsed = db.prepare(
      "UPDATE registration_tokens SET used = 1 WHERE token_hash = ? AND used = 0 AND expires_at > ?",
    );
  }

  /**
   * userId のユーザーに登録トークンを発行する。ユーザーがいなければ UserNotFoundError。
   * 同じユーザーの未使用のトークンは、このとき無効になる。
   * 返す token は平文で、DB には残らない（この戻り値でしか見られない）。
   */
  issue(userId: string): { token: string; code: string; expiresAt: number } {
    // 別の接続（並行して動く CLI など）の発行と混ざらないよう、確認から挿入までを 1 つのトランザクションにする
    return inTransaction(this.#db, () => {
      if (!this.#userExists.get(userId)) throw new UserNotFoundError(userId);
      const now = this.#now();
      // 使えなくなった行（使用済み・期限切れ）は、照合でも無効と同じ扱いなので、ここで片付ける
      this.#purge.run(now);
      // 発行し直したら、同じユーザーの前の未使用トークンは使えなくする（どれか 1 つだけが有効）
      this.#revokeUnused.run(userId);
      const token = randomBytes(32).toString("base64url");
      const code = randomInt(0, 10000).toString().padStart(4, "0");
      const expiresAt = now + REGISTRATION_TTL_MS;
      this.#insert.run(sha256(token), userId, code, expiresAt);
      return { token, code, expiresAt };
    });
  }

  /** 有効（存在・未使用・期限内）なトークンのユーザーと、保存済みの challenge を返す */
  get(token: string): { user: User; challenge?: string } | undefined {
    const hash = hashInput(token);
    if (!hash) return undefined;
    const row = this.#getValid.get(hash, this.#now());
    if (!row) return undefined;
    return { user: toUser(row), ...optionalChallenge(row) };
  }

  /** 確認コードを照合する。間違いは MAX_CODE_ATTEMPTS 回までで、達したらトークンを無効にする */
  checkCode(token: string, code: string): CodeCheck {
    const hash = hashInput(token);
    if (!hash) return { status: "invalid" };
    const row = this.#getForCheck.get(hash, this.#now());
    if (!row) return { status: "invalid" };
    if (sameCode(rowString(row, "code"), code)) return { status: "ok" };
    const counted = this.#countWrong.get(MAX_CODE_ATTEMPTS, hash);
    if (!counted) return { status: "invalid" };
    return { status: "wrong", remaining: Math.max(0, MAX_CODE_ATTEMPTS - rowNumber(counted, "attempts")) };
  }

  /** 登録オプションの challenge を覚える。有効でないトークンには何もしない */
  setChallenge(token: string, challenge: string): void {
    const hash = hashInput(token);
    if (hash) this.#setChallenge.run(challenge, hash);
  }

  /**
   * 覚えている challenge を捨てる。検証に失敗した登録は、同じ challenge でやり直せないようにする
   * （もう一度 options からやり直す）。有効でないトークンには何もしない。
   */
  clearChallenge(token: string): void {
    const hash = hashInput(token);
    if (hash) this.#clearChallenge.run(hash);
  }

  /**
   * 有効なトークンを使用済みにする。今回の呼び出しで使用済みにできたら true。
   * すでに使用済み・期限切れ・無いトークンは false。同時に 2 回呼んでも、true になるのは 1 回だけ
   * （登録の確定の前に呼べば、同じトークンでの二重登録を防げる）。
   */
  markUsed(token: string): boolean {
    const hash = hashInput(token);
    return hash !== undefined && Number(this.#markUsed.run(hash, this.#now()).changes) > 0;
  }
}

function toUser(row: Row): User {
  return { id: rowString(row, "id"), name: rowString(row, "name"), createdAt: rowNumber(row, "created_at") };
}

function optionalChallenge(row: Row): { challenge?: string } {
  const challenge = rowOptionalString(row, "challenge");
  return challenge === undefined ? {} : { challenge };
}
