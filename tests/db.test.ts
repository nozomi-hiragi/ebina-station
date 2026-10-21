import { assert, assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { DatabaseSync } from "node:sqlite";
import { inTransaction, migrate, openDatabase } from "../src/db/mod.ts";
import { LATEST_SCHEMA_VERSION } from "../src/db/schema.ts";
import { getOrCreateWakeSecret } from "../src/db/meta.ts";
import { AppStateRepo } from "../src/db/app_states.ts";

function userVersion(db: DatabaseSync): number {
  return Number(db.prepare("PRAGMA user_version").get()?.user_version);
}

function tableNames(db: DatabaseSync): string[] {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((row) => String(row.name));
}

async function withTempDir(fn: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "ebina-db-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("db: 開くと移行が済み、必要なテーブルがある", () => {
  const db = openDatabase(":memory:");
  try {
    assertEquals(userVersion(db), LATEST_SCHEMA_VERSION);
    assertEquals(tableNames(db), ["app_states", "credentials", "meta", "registration_tokens", "users"]);
    assertEquals(Number(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys), 1);
    assertEquals(Number(db.prepare("PRAGMA busy_timeout").get()?.timeout), 5000);
  } finally {
    db.close();
  }
});

Deno.test("db: ファイルの DB はフォルダを作り、WAL で、0600 になる", async () => {
  await withTempDir((dir) => {
    const path = join(dir, "data", "station", "station.db");
    const db = openDatabase(path);
    try {
      assertEquals(String(db.prepare("PRAGMA journal_mode").get()?.journal_mode), "wal");
      if (Deno.build.os !== "windows") {
        assertEquals(Deno.statSync(path).mode! & 0o777, 0o600);
      }
    } finally {
      db.close();
    }
  });
});

Deno.test("db: 権限が緩い既存のファイルは 0600 に締める", async () => {
  if (Deno.build.os === "windows") return;
  await withTempDir((dir) => {
    const path = join(dir, "station.db");
    openDatabase(path).close();
    Deno.chmodSync(path, 0o644);
    openDatabase(path).close();
    assertEquals(Deno.statSync(path).mode! & 0o777, 0o600);
  });
});

Deno.test("db: 開き直しても移行は二重に適用されず、データが残る", async () => {
  await withTempDir((dir) => {
    const path = join(dir, "station.db");
    const first = openDatabase(path);
    first.prepare("INSERT INTO users (id, name, created_at) VALUES ('alice', 'Alice', 1)").run();
    first.close();

    const second = openDatabase(path);
    try {
      assertEquals(userVersion(second), LATEST_SCHEMA_VERSION);
      assertEquals(second.prepare("SELECT COUNT(*) AS n FROM users").get()?.n, 1);
      migrate(second); // 何度呼んでも何も起きない
      assertEquals(userVersion(second), LATEST_SCHEMA_VERSION);
    } finally {
      second.close();
    }
  });
});

Deno.test("db: 同じファイルを 2 つの接続で同時に開いても壊れない（Station と CLI）", async () => {
  await withTempDir((dir) => {
    const path = join(dir, "station.db");
    const a = openDatabase(path);
    const b = openDatabase(path);
    try {
      a.prepare("INSERT INTO users (id, name, created_at) VALUES ('alice', 'Alice', 1)").run();
      assertEquals(b.prepare("SELECT name FROM users WHERE id = 'alice'").get()?.name, "Alice");
    } finally {
      a.close();
      b.close();
    }
  });
});

Deno.test("db: 新しい版の DB は開かずに投げる", async () => {
  await withTempDir((dir) => {
    const path = join(dir, "station.db");
    const raw = new DatabaseSync(path);
    raw.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    raw.close();
    assertThrows(() => openDatabase(path), Error, "新しい");
  });
});

Deno.test("db: 外部キーでユーザーを消すとパスキーと登録トークンも消える", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare("INSERT INTO users (id, name, created_at) VALUES ('alice', 'Alice', 1)").run();
    db.prepare(
      `INSERT INTO credentials (credential_id, user_id, user_handle, public_key, algorithm, sign_count,
         backup_eligible, status, created_at) VALUES (x'01', 'alice', x'02', x'03', -7, 0, 0, 'active', 1)`,
    ).run();
    db.prepare(
      "INSERT INTO registration_tokens (token_hash, user_id, code, expires_at) VALUES ('h', 'alice', '0000', 1)",
    )
      .run();
    // 存在しないユーザーのパスキーは入れられない
    assertThrows(() =>
      db.prepare(
        `INSERT INTO credentials (credential_id, user_id, user_handle, public_key, algorithm, sign_count,
           backup_eligible, status, created_at) VALUES (x'09', 'nobody', x'02', x'03', -7, 0, 0, 'active', 1)`,
      ).run()
    );
    db.prepare("DELETE FROM users WHERE id = 'alice'").run();
    assertEquals(db.prepare("SELECT COUNT(*) AS n FROM credentials").get()?.n, 0);
    assertEquals(db.prepare("SELECT COUNT(*) AS n FROM registration_tokens").get()?.n, 0);
  } finally {
    db.close();
  }
});

Deno.test("db: inTransaction は確定し、投げたら巻き戻す", () => {
  const db = openDatabase(":memory:");
  try {
    const count = () => Number(db.prepare("SELECT COUNT(*) AS n FROM users").get()?.n);
    const insert = (id: string) => db.prepare("INSERT INTO users (id, name, created_at) VALUES (?, ?, 1)").run(id, id);

    assertEquals(inTransaction(db, () => (insert("a"), "done")), "done");
    assertEquals(count(), 1);

    assertThrows(
      () =>
        inTransaction(db, () => {
          insert("b");
          throw new Error("途中で失敗");
        }),
      Error,
      "途中で失敗",
    );
    assertEquals(count(), 1);
    assertEquals(db.isTransaction, false);

    // 入れ子は外側とまとめて巻き戻る
    assertThrows(() =>
      inTransaction(db, () => {
        insert("c");
        inTransaction(db, () => insert("d"));
        throw new Error("外側で失敗");
      })
    );
    assertEquals(count(), 1);
  } finally {
    db.close();
  }
});

Deno.test("db: WAKE の secret は 32 バイトで、2 回目以降は同じ値、開き直しても残る", async () => {
  await withTempDir((dir) => {
    const path = join(dir, "station.db");
    const db = openDatabase(path);
    const first = getOrCreateWakeSecret(db);
    assertEquals(first.length, 32);
    assertEquals(getOrCreateWakeSecret(db), first);
    // 返した値を書き換えても保存された値は変わらない
    first.fill(0);
    assertNotEquals(getOrCreateWakeSecret(db), first);
    const saved = getOrCreateWakeSecret(db);
    db.close();

    const reopened = openDatabase(path);
    try {
      assertEquals(getOrCreateWakeSecret(reopened), saved);
    } finally {
      reopened.close();
    }
  });
});

Deno.test("db: DB ごとに別の WAKE の secret ができる", () => {
  const a = openDatabase(":memory:");
  const b = openDatabase(":memory:");
  try {
    assertNotEquals(getOrCreateWakeSecret(a), getOrCreateWakeSecret(b));
  } finally {
    a.close();
    b.close();
  }
});

Deno.test("db: 長さの違う WAKE の secret が保存されていたら投げる", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare("INSERT INTO meta (key, value) VALUES ('wake_secret', x'0102')").run();
    assertThrows(() => getOrCreateWakeSecret(db), Error, "secret");
  } finally {
    db.close();
  }
});

Deno.test("db: アプリは既定で有効、無効にした行だけを持つ", () => {
  const db = openDatabase(":memory:");
  try {
    const states = new AppStateRepo(db);
    const rows = () => Number(db.prepare("SELECT COUNT(*) AS n FROM app_states").get()?.n);
    assertEquals(states.isEnabled("echo"), true);
    assertEquals(rows(), 0);

    states.setEnabled("echo", false);
    assertEquals(states.isEnabled("echo"), false);
    assertEquals(states.isEnabled("notes"), true);
    states.setEnabled("echo", false); // 2 回目も同じ
    assertEquals(rows(), 1);

    states.setEnabled("echo", true);
    assertEquals(states.isEnabled("echo"), true);
    assertEquals(rows(), 0);

    assertThrows(() => states.setEnabled("../x", false), Error, "アプリ名");
    assertThrows(() => states.setEnabled("Echo", false), Error, "アプリ名");
  } finally {
    db.close();
  }
});

Deno.test("db: アプリの無効は開き直しても残る", async () => {
  await withTempDir((dir) => {
    const path = join(dir, "station.db");
    const db = openDatabase(path);
    new AppStateRepo(db).setEnabled("echo", false);
    db.close();
    const reopened = openDatabase(path);
    try {
      assert(!new AppStateRepo(reopened).isEnabled("echo"));
    } finally {
      reopened.close();
    }
  });
});

Deno.test("db: project の中の DB までの道にシンボリックリンクがあれば開かず、リンク先も触らない", async () => {
  const root = await Deno.makeTempDir({ prefix: "ebina-db-link-" });
  const outside = await Deno.makeTempDir({ prefix: "ebina-db-outside-" });
  try {
    const target = join(outside, "victim.db");
    await Deno.writeTextFile(target, "victim", { mode: 0o644 });
    const dbPath = join(root, "data", "station", "station.db");

    // DB ファイルがリンク
    await Deno.mkdir(join(root, "data", "station"), { recursive: true });
    await Deno.symlink(target, dbPath);
    assertThrows(() => openDatabase(dbPath, { root }), Error, "シンボリックリンク");
    assertEquals(await Deno.readTextFile(target), "victim");
    assertEquals((await Deno.stat(target)).mode! & 0o777, 0o644);
    await Deno.remove(dbPath);

    // WAL の補助ファイルがリンク
    await Deno.symlink(target, `${dbPath}-wal`);
    assertThrows(() => openDatabase(dbPath, { root }), Error, "シンボリックリンク");
    await Deno.remove(`${dbPath}-wal`);

    // 途中のフォルダがリンク
    await Deno.remove(join(root, "data"), { recursive: true });
    await Deno.symlink(outside, join(root, "data"));
    assertThrows(() => openDatabase(join(root, "data", "station.db"), { root }), Error, "シンボリックリンク");
    assertEquals((await Array.fromAsync(Deno.readDir(outside))).map((e) => e.name), ["victim.db"]);

    // project フォルダ自体がリンクなのは許す
    await Deno.remove(join(root, "data"));
    const linkedRoot = `${root}-link`;
    await Deno.symlink(root, linkedRoot);
    try {
      openDatabase(join(linkedRoot, "data", "station", "station.db"), { root: linkedRoot }).close();
    } finally {
      await Deno.remove(linkedRoot);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});
