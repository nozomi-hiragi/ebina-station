import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { MemoryCredentialStore } from "@wake-protocol/server";
import type { WakeCredential } from "@wake-protocol/server";
import { Buffer } from "node:buffer";
import { openDatabase } from "../src/db/mod.ts";
import { UserRepo } from "../src/db/users.ts";
import { CredentialExistsError, SqliteCredentialStore } from "../src/db/credentials.ts";

function credential(id: number, userId: string, extra: Partial<WakeCredential> = {}): WakeCredential {
  return {
    credentialId: new Uint8Array([id, id, id, id]),
    userId,
    userHandle: new TextEncoder().encode(`handle-${userId}`),
    publicKey: new Uint8Array([0x30, 0x59, id]),
    algorithm: -7,
    signCount: 0,
    backupEligible: false,
    status: "active",
    ...extra,
  };
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function setup(userIds: string[] = ["alice", "bob"]) {
  const db = openDatabase(":memory:");
  const users = new UserRepo(db);
  for (const id of userIds) users.create(id, id);
  return { db, users, store: new SqliteCredentialStore(db) };
}

Deno.test("credentials: 足したものをそのまま取り出せる", async () => {
  const { db, store } = setup();
  try {
    const full = credential(1, "alice", {
      signCount: 42,
      backupEligible: true,
      status: "pending",
      transports: ["internal", "hybrid"],
    });
    const plain = credential(2, "alice");
    store.add(full);
    store.add(plain);

    assertEquals(await store.getCredential(full.credentialId), full);
    assertEquals(await store.getCredential(plain.credentialId), plain);
    // transports が無いものには transports の欄ごと無い
    assertEquals("transports" in (await store.getCredential(plain.credentialId))!, false);
    assertEquals(await store.getCredential(new Uint8Array([9, 9])), null);
  } finally {
    db.close();
  }
});

Deno.test("credentials: 取り出した値を書き換えても保存された値は変わらない", async () => {
  const { db, store } = setup();
  try {
    const original = credential(1, "alice", { transports: ["internal"] });
    store.add(original);
    const got = (await store.getCredential(original.credentialId))!;
    got.publicKey.fill(0);
    got.credentialId.fill(0);
    got.transports!.push("usb");
    assertEquals(await store.getCredential(original.credentialId), original);
  } finally {
    db.close();
  }
});

Deno.test("credentials: 同じ credentialId は CredentialExistsError で、元の値は変わらない", async () => {
  const { db, store } = setup();
  try {
    store.add(credential(1, "alice", { signCount: 7 }));
    assertThrows(() => store.add(credential(1, "alice", { signCount: 99 })), CredentialExistsError);
    // 別のユーザーの名前でも同じ
    assertThrows(() => store.add(credential(1, "bob")), CredentialExistsError);
    assertEquals((await store.getCredential(credential(1, "alice").credentialId))?.signCount, 7);
    assertEquals(store.listByUser("alice").length, 1);
    assertEquals(store.listByUser("bob").length, 0);
  } finally {
    db.close();
  }
});

Deno.test("credentials: いないユーザーのパスキーは足せない", () => {
  const { db, store } = setup();
  try {
    assertThrows(() => store.add(credential(1, "nobody")), Error, "nobody");
    assertEquals(store.listByUser("nobody"), []);
  } finally {
    db.close();
  }
});

Deno.test("credentials: 不正な値は足せない", () => {
  const { db, store } = setup();
  try {
    assertThrows(() => store.add(credential(1, "alice", { signCount: -1 })), RangeError);
    assertThrows(() => store.add(credential(1, "alice", { signCount: 1.5 })), RangeError);
    assertThrows(() => store.add(credential(1, "alice", { status: "weird" as WakeCredential["status"] })), RangeError);
    assertEquals(store.listByUser("alice"), []);
  } finally {
    db.close();
  }
});

Deno.test("credentials: ユーザーのパスキーは足した順に並び、他のユーザーのものは混ざらない", async () => {
  const { db, store } = setup();
  try {
    store.add(credential(3, "alice"));
    store.add(credential(1, "alice"));
    store.add(credential(2, "bob"));
    const ids = (list: WakeCredential[]) => list.map((c) => c.credentialId[0]);
    assertEquals(ids(store.listByUser("alice")), [3, 1]);
    assertEquals(ids(await store.findUserCredentials("alice")), [3, 1]);
    assertEquals(ids(await store.findUserCredentials("bob")), [2]);
    assertEquals(await store.findUserCredentials("nobody"), []);
  } finally {
    db.close();
  }
});

Deno.test("credentials: ユーザー名はユーザー ID として引く", async () => {
  const { db, store } = setup(["alice", "bob"]);
  try {
    store.add(credential(1, "alice"));
    const found = await store.findUserByUsername("alice");
    assertEquals(found?.userId, "alice");
    assertEquals(found?.credentials.length, 1);
    // パスキーが 0 件のユーザーは、空の一覧で返す
    assertEquals(await store.findUserByUsername("bob"), { userId: "bob", credentials: [] });
    assertEquals(await store.findUserByUsername("carol"), null);
    // 大文字小文字は区別する
    assertEquals(await store.findUserByUsername("Alice"), null);
  } finally {
    db.close();
  }
});

Deno.test("credentials: compareAndSetSignCount は期待値のときだけ進める", async () => {
  const { db, store } = setup();
  try {
    const c = credential(1, "alice", { signCount: 5 });
    store.add(c);
    assertEquals(await store.compareAndSetSignCount(c.credentialId, 5, 6), true);
    assertEquals((await store.getCredential(c.credentialId))?.signCount, 6);
    // 古い期待値は失敗して、値は変わらない
    assertEquals(await store.compareAndSetSignCount(c.credentialId, 5, 7), false);
    assertEquals((await store.getCredential(c.credentialId))?.signCount, 6);
    // 小さい値への更新も、期待値が合えば通す（memory 版と同じ。大小の判断は WAKE が行う）
    assertEquals(await store.compareAndSetSignCount(c.credentialId, 6, 2), true);
    assertEquals((await store.getCredential(c.credentialId))?.signCount, 2);
    // 無いパスキーは false
    assertEquals(await store.compareAndSetSignCount(new Uint8Array([9]), 0, 1), false);
  } finally {
    db.close();
  }
});

Deno.test("credentials: 同じ期待値での更新は 1 つだけが成功する（接続が別でも）", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ebina-cred-test-" });
  const dbA = openDatabase(join(dir, "station.db"));
  const dbB = openDatabase(join(dir, "station.db"));
  try {
    new UserRepo(dbA).create("alice", "Alice");
    const a = new SqliteCredentialStore(dbA);
    const b = new SqliteCredentialStore(dbB);
    const c = credential(1, "alice", { signCount: 10 });
    a.add(c);
    const results = await Promise.all([
      a.compareAndSetSignCount(c.credentialId, 10, 11),
      b.compareAndSetSignCount(c.credentialId, 10, 12),
    ]);
    assertEquals(results.filter(Boolean).length, 1);
    const final = (await b.getCredential(c.credentialId))!.signCount;
    assertEquals(final, results[0] ? 11 : 12);
  } finally {
    dbA.close();
    dbB.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("credentials: updateSignCount は大きい方を残し、無ければ投げる", async () => {
  const { db, store } = setup();
  try {
    const c = credential(1, "alice", { signCount: 10 });
    store.add(c);
    await store.updateSignCount(c.credentialId, 4);
    assertEquals((await store.getCredential(c.credentialId))?.signCount, 10);
    await store.updateSignCount(c.credentialId, 25);
    assertEquals((await store.getCredential(c.credentialId))?.signCount, 25);
    await store.updateSignCount(c.credentialId, 25);
    assertEquals((await store.getCredential(c.credentialId))?.signCount, 25);
    await assertRejects(() => store.updateSignCount(new Uint8Array([9]), 1), Error, "パスキーが消えました");
  } finally {
    db.close();
  }
});

Deno.test("credentials: 4294967295 までのカウンターを扱える", async () => {
  const { db, store } = setup();
  try {
    const c = credential(1, "alice", { signCount: 4294967290 });
    store.add(c);
    assertEquals(await store.compareAndSetSignCount(c.credentialId, 4294967290, 4294967295), true);
    assertEquals((await store.getCredential(c.credentialId))?.signCount, 4294967295);
  } finally {
    db.close();
  }
});

Deno.test("credentials: isActive は active のパスキーとユーザーの組だけ true", () => {
  const { db, store } = setup();
  try {
    const active = credential(1, "alice");
    const pending = credential(2, "alice", { status: "pending" });
    const suspended = credential(3, "alice", { status: "suspended" });
    const deleted = credential(4, "alice", { status: "deleted" });
    for (const c of [active, pending, suspended, deleted]) store.add(c);

    assertEquals(store.isActive(b64url(active.credentialId), "alice"), true);
    assertEquals(store.isActive(b64url(active.credentialId), "bob"), false);
    assertEquals(store.isActive(b64url(pending.credentialId), "alice"), false);
    assertEquals(store.isActive(b64url(suspended.credentialId), "alice"), false);
    assertEquals(store.isActive(b64url(deleted.credentialId), "alice"), false);
    assertEquals(store.isActive(b64url(new Uint8Array([7, 7, 7, 7])), "alice"), false);
    // base64url として正しくない文字列は false（投げない）
    for (const bad of ["", "!!!", "AQEB AQ", "AQEBAQ==", "AQEB/A"]) {
      assertEquals(store.isActive(bad, "alice"), false, bad);
    }
  } finally {
    db.close();
  }
});

Deno.test("credentials: remove とユーザー削除", async () => {
  const { db, users, store } = setup();
  try {
    const a = credential(1, "alice");
    const b = credential(2, "alice");
    store.add(a);
    store.add(b);
    assertEquals(store.remove(a.credentialId), true);
    assertEquals(store.remove(a.credentialId), false);
    assertEquals(await store.getCredential(a.credentialId), null);
    assertEquals(store.isActive(b64url(a.credentialId), "alice"), false);
    assert(await store.getCredential(b.credentialId));

    // ユーザーを消すとパスキーも消える
    users.remove("alice");
    assertEquals(await store.getCredential(b.credentialId), null);
    assertEquals(await store.findUserByUsername("alice"), null);
  } finally {
    db.close();
  }
});

// MemoryCredentialStore（@wake-protocol/server 同梱）と同じ入力に同じ結果を返すこと
Deno.test("credentials: memory 版と同じ操作で同じ結果になる", async () => {
  const { db, store } = setup(["alice", "bob"]);
  try {
    const memory = new MemoryCredentialStore();
    const sqlite: CredentialStoreLike = store;
    const creds = [
      credential(1, "alice", { signCount: 5, transports: ["internal"] }),
      credential(2, "alice", { backupEligible: true, status: "pending" }),
      credential(3, "bob", { signCount: 100 }),
    ];
    for (const c of creds) {
      memory.setCredential(c, c.userId);
      store.add(c);
    }

    const snapshot = async (s: CredentialStoreLike) => ({
      one: await s.getCredential(creds[0].credentialId),
      two: await s.getCredential(creds[1].credentialId),
      unknown: await s.getCredential(new Uint8Array([9, 9, 9, 9])),
      alice: await s.findUserCredentials("alice"),
      bob: await s.findUserCredentials("bob"),
      nobody: await s.findUserCredentials("nobody"),
      byAlice: await s.findUserByUsername("alice"),
      byBob: await s.findUserByUsername("bob"),
      byCarol: await s.findUserByUsername("carol"),
    });
    assertEquals(await snapshot(sqlite), await snapshot(memory));

    const operate = async (s: CredentialStoreLike) => {
      const id = creds[0].credentialId;
      const out: unknown[] = [];
      out.push(await s.compareAndSetSignCount(id, 5, 6));
      out.push(await s.compareAndSetSignCount(id, 5, 7));
      out.push(await s.compareAndSetSignCount(new Uint8Array([9, 9, 9, 9]), 0, 1));
      await s.updateSignCount(id, 3);
      out.push((await s.getCredential(id))?.signCount);
      await s.updateSignCount(id, 50);
      out.push((await s.getCredential(id))?.signCount);
      try {
        await s.updateSignCount(new Uint8Array([9, 9, 9, 9]), 1);
        out.push("not thrown");
      } catch {
        out.push("thrown");
      }
      return out;
    };
    assertEquals(await operate(sqlite), await operate(memory));
    assertEquals(await snapshot(sqlite), await snapshot(memory));
  } finally {
    db.close();
  }
});

type CredentialStoreLike = Pick<
  SqliteCredentialStore,
  | "getCredential"
  | "findUserCredentials"
  | "findUserByUsername"
  | "compareAndSetSignCount"
  | "updateSignCount"
>;
