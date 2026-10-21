import type { DatabaseSync, StatementSync } from "node:sqlite";
import { isAppNameFormat } from "../apps/names.ts";
import { rowNumber } from "./row.ts";

/**
 * アプリの有効・無効。見つけたアプリは有効が既定なので、無効にしたものだけ enabled = 0 の行で持つ
 * （有効に戻すと行を消す）。
 */
export class AppStateRepo {
  readonly #get: StatementSync;
  readonly #disable: StatementSync;
  readonly #enable: StatementSync;

  constructor(db: DatabaseSync) {
    this.#get = db.prepare("SELECT enabled FROM app_states WHERE name = ?");
    this.#disable = db.prepare(
      "INSERT INTO app_states (name, enabled) VALUES (?, 0) ON CONFLICT(name) DO UPDATE SET enabled = 0",
    );
    this.#enable = db.prepare("DELETE FROM app_states WHERE name = ?");
  }

  /** 行が無ければ true */
  isEnabled(name: string): boolean {
    const row = this.#get.get(name);
    return row === undefined || rowNumber(row, "enabled") !== 0;
  }

  setEnabled(name: string, enabled: boolean): void {
    if (!isAppNameFormat(name)) throw new Error(`アプリ名の形式が正しくありません: ${JSON.stringify(name)}`);
    if (enabled) this.#enable.run(name);
    else this.#disable.run(name);
  }
}
