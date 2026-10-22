import { Buffer } from "node:buffer";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { CredentialStore, WakeCredential } from "@wake-protocol/server";
import { type Row, rowBool, rowBytes, rowNumber, rowOptionalString, rowString } from "./row.ts";
import { UserNotFoundError } from "./users.ts";

export class CredentialExistsError extends Error {
  constructor() {
    super("このパスキーはすでに登録されています");
    this.name = "CredentialExistsError";
  }
}

const STATUSES: readonly WakeCredential["status"][] = ["active", "pending", "suspended", "deleted"];

const COLUMNS =
  "credential_id, user_id, user_handle, public_key, algorithm, sign_count, backup_eligible, status, transports";

function parseStatus(value: string): WakeCredential["status"] {
  const status = STATUSES.find((s) => s === value);
  if (!status) throw new Error(`DB のパスキーの status が正しくありません: ${value}`);
  return status;
}

function parseTransports(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((t) => typeof t === "string")) {
    throw new Error("DB のパスキーの transports が正しくありません");
  }
  return parsed;
}

function toCredential(row: Row): WakeCredential {
  const transports = parseTransports(rowOptionalString(row, "transports"));
  return {
    credentialId: rowBytes(row, "credential_id"),
    userId: rowString(row, "user_id"),
    userHandle: rowBytes(row, "user_handle"),
    publicKey: rowBytes(row, "public_key"),
    algorithm: rowNumber(row, "algorithm"),
    signCount: rowNumber(row, "sign_count"),
    backupEligible: rowBool(row, "backup_eligible"),
    status: parseStatus(rowString(row, "status")),
    ...(transports ? { transports } : {}),
  };
}

/** base64url（パディングなし）を byte 列にする。形式が正しくなければ undefined */
function decodeBase64url(text: string): Uint8Array | undefined {
  if (text.length === 0 || !/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  return new Uint8Array(Buffer.from(text, "base64url"));
}

/** 同期の処理を、投げたら reject になる Promise にする（CredentialStore は Promise を返す約束） */
function settle<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
}

/**
 * パスキーを SQLite に保存する WAKE の CredentialStore。
 * 意味は @wake-protocol/server の MemoryCredentialStore と同じ（ユーザー名はユーザー ID）。
 */
export class SqliteCredentialStore implements CredentialStore {
  readonly #insert: StatementSync;
  readonly #get: StatementSync;
  readonly #listByUser: StatementSync;
  readonly #userExists: StatementSync;
  readonly #compareAndSet: StatementSync;
  readonly #raise: StatementSync;
  readonly #remove: StatementSync;
  readonly #isActive: StatementSync;

  constructor(db: DatabaseSync) {
    this.#insert = db.prepare(
      `INSERT INTO credentials (${COLUMNS}, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(credential_id) DO NOTHING`,
    );
    this.#get = db.prepare(`SELECT ${COLUMNS} FROM credentials WHERE credential_id = ?`);
    this.#listByUser = db.prepare(`SELECT ${COLUMNS} FROM credentials WHERE user_id = ? ORDER BY created_at, rowid`);
    this.#userExists = db.prepare("SELECT 1 AS found FROM users WHERE id = ?");
    this.#compareAndSet = db.prepare(
      "UPDATE credentials SET sign_count = ? WHERE credential_id = ? AND sign_count = ?",
    );
    this.#raise = db.prepare("UPDATE credentials SET sign_count = MAX(sign_count, ?) WHERE credential_id = ?");
    this.#remove = db.prepare("DELETE FROM credentials WHERE credential_id = ?");
    this.#isActive = db.prepare(
      "SELECT 1 AS found FROM credentials WHERE credential_id = ? AND user_id = ? AND status = 'active'",
    );
  }

  /** パスキーを足す。同じ credentialId があれば CredentialExistsError、ユーザーがいなければ UserNotFoundError */
  add(cred: WakeCredential): void {
    if (!Number.isSafeInteger(cred.signCount) || cred.signCount < 0) {
      throw new RangeError("signCount は 0 以上の整数にしてください");
    }
    if (!STATUSES.includes(cred.status)) throw new RangeError(`status が正しくありません: ${cred.status}`);
    if (!this.#userExists.get(cred.userId)) throw new UserNotFoundError(cred.userId);
    const result = this.#insert.run(
      cred.credentialId,
      cred.userId,
      cred.userHandle,
      cred.publicKey,
      cred.algorithm,
      cred.signCount,
      cred.backupEligible ? 1 : 0,
      cred.status,
      cred.transports ? JSON.stringify(cred.transports) : null,
      Date.now(),
    );
    if (Number(result.changes) === 0) throw new CredentialExistsError();
  }

  /** ユーザーのパスキーを登録の古い順に返す（status を問わない） */
  listByUser(userId: string): WakeCredential[] {
    return this.#listByUser.all(userId).map(toCredential);
  }

  /** ET の確認用。credentialId は base64url（パディングなし）。そのユーザーの active なパスキーがあれば true */
  isActive(credentialIdB64url: string, userId: string): boolean {
    const id = decodeBase64url(credentialIdB64url);
    return id !== undefined && this.#isActive.get(id, userId) !== undefined;
  }

  /** パスキーを消す。消したら true */
  remove(credentialId: Uint8Array): boolean {
    return Number(this.#remove.run(credentialId).changes) > 0;
  }

  getCredential(credentialId: Uint8Array): Promise<WakeCredential | null> {
    return settle(() => {
      const row = this.#get.get(credentialId);
      return row ? toCredential(row) : null;
    });
  }

  findUserCredentials(userId: string): Promise<WakeCredential[]> {
    return settle(() => this.listByUser(userId));
  }

  /** ユーザー名はユーザー ID。ユーザーがいなければ null（パスキーが 0 件でもユーザーがいれば返す） */
  findUserByUsername(username: string): Promise<{ userId: string; credentials: WakeCredential[] } | null> {
    return settle(() => {
      if (!this.#userExists.get(username)) return null;
      return { userId: username, credentials: this.listByUser(username) };
    });
  }

  /** 1 つの UPDATE で、現在の値が expected のときだけ next にする */
  compareAndSetSignCount(credentialId: Uint8Array, expected: number, next: number): Promise<boolean> {
    return settle(() => Number(this.#compareAndSet.run(next, credentialId, expected).changes) === 1);
  }

  /** 今の値と signCount の大きい方にする。パスキーが無ければ投げる */
  updateSignCount(credentialId: Uint8Array, signCount: number): Promise<void> {
    return settle(() => {
      const result = this.#raise.run(signCount, credentialId);
      if (Number(result.changes) === 0) throw new Error("認証の途中でパスキーが消えました");
    });
  }
}
