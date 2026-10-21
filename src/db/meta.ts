import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { rowBytes } from "./row.ts";

const WAKE_SECRET_KEY = "wake_secret";
const WAKE_SECRET_LENGTH = 32;

function readSecret(db: DatabaseSync): Uint8Array | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(WAKE_SECRET_KEY);
  if (!row) return undefined;
  const secret = rowBytes(row, "value");
  if (secret.length !== WAKE_SECRET_LENGTH) {
    throw new Error("DB に保存された WAKE の secret の長さが正しくありません。DB が壊れている可能性があります");
  }
  return secret;
}

/**
 * WAKE の secret（32 バイトの乱数）を返す。無ければ作って meta に保存する。
 * 同時に作られても、先に保存された値が使われる。
 */
export function getOrCreateWakeSecret(db: DatabaseSync): Uint8Array {
  const existing = readSecret(db);
  if (existing) return existing;
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").run(
    WAKE_SECRET_KEY,
    new Uint8Array(randomBytes(WAKE_SECRET_LENGTH)),
  );
  const saved = readSecret(db);
  if (!saved) throw new Error("WAKE の secret を保存できませんでした");
  return saved;
}
