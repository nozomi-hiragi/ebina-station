/** DB の移行。version は PRAGMA user_version に記録する。末尾に足すだけで、過去のものは書き換えない */
export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE credentials (
  credential_id BLOB PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_handle BLOB NOT NULL, public_key BLOB NOT NULL, algorithm INTEGER NOT NULL,
  sign_count INTEGER NOT NULL, backup_eligible INTEGER NOT NULL, status TEXT NOT NULL,
  transports TEXT, created_at INTEGER NOT NULL);
CREATE INDEX credentials_user ON credentials(user_id);
CREATE TABLE registration_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, challenge TEXT);
CREATE TABLE app_states (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
`,
  },
];

/** このコードが扱える最新の版 */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
