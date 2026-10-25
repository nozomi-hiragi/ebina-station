import type { DatabaseSync } from "node:sqlite";
import {
  createWakeServer,
  type CredentialStore,
  type EtHandler,
  MemoryWakeStore,
  type WakeServer,
  type WakeStore,
} from "@wake-protocol/server";
import type { StationConfig } from "./config.ts";
import { getOrCreateWakeSecret } from "./db/meta.ts";

export interface StationWakeDeps {
  config: StationConfig;
  /** WAKE の secret を保存する DB（無ければ作る） */
  db: DatabaseSync;
  /** パスキーの保存先（SQLite。通常は Accounts の wakeCredentials を渡す） */
  credentials: CredentialStore;
  etHandler: EtHandler;
  /**
   * セッションの保存先。既定はメモリ。
   * @wake-protocol/server 0.6.1 はセッション鍵を取り出せない CryptoKey で作るため、ファイルには保存できない。
   * Station を再起動したらログインし直しになる
   */
  store?: WakeStore;
}

/** Station の WAKE サーバー（`/auth/*`、`/wake/*`）を作る */
export function createStationWake(deps: StationWakeDeps): WakeServer {
  return createWakeServer({
    rpId: deps.config.rpId,
    loginOrigins: deps.config.origins,
    credentials: deps.credentials,
    store: deps.store ?? new MemoryWakeStore(),
    secret: getOrCreateWakeSecret(deps.db),
    etHandler: deps.etHandler,
  });
}
