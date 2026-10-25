import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { openDatabase } from "../src/db/mod.ts";
import { UserExistsError, UserRepo, validateUserId, validateUserName } from "../src/accounts/users.ts";

function withUsers(fn: (users: UserRepo) => void): void {
  const db = openDatabase(":memory:");
  try {
    fn(new UserRepo(db));
  } finally {
    db.close();
  }
}

Deno.test("users: ユーザー ID の検査", () => {
  for (const id of ["a", "alice", "Alice_01", "a.b-c", "A".repeat(64)]) {
    assertEquals(validateUserId(id), null, id);
  }
  for (const id of ["", "A".repeat(65), "a b", "a/b", "日本語", "a@b", "a\n", " a"]) {
    assertEquals(typeof validateUserId(id), "string", JSON.stringify(id));
  }
});

Deno.test("users: 名前の検査", () => {
  for (const name of ["a", "Alice", "ひらぎ のぞみ", "  前後に空白  ", "あ".repeat(64), "😀".repeat(64)]) {
    assertEquals(validateUserName(name), null, name);
  }
  for (const name of ["", "   ", "\t\n", "あ".repeat(65), "😀".repeat(65), "a\nb", "a\u0000b"]) {
    assertEquals(typeof validateUserName(name), "string", JSON.stringify(name));
  }
});

Deno.test("users: 作る・取る・一覧・消す", () => {
  withUsers((users) => {
    const alice = users.create("alice", "Alice");
    assertEquals(alice.id, "alice");
    assertEquals(alice.name, "Alice");
    assertEquals(Number.isInteger(alice.createdAt), true);
    assertEquals(users.get("alice"), alice);
    assertEquals(users.get("nobody"), undefined);

    users.create("bob", "Bob");
    assertEquals(users.list().map((u) => u.id), ["alice", "bob"]);

    assertEquals(users.remove("alice"), true);
    assertEquals(users.remove("alice"), false);
    assertEquals(users.get("alice"), undefined);
    assertEquals(users.list().map((u) => u.id), ["bob"]);
  });
});

Deno.test("users: 名前は前後の空白を除いて保存する", () => {
  withUsers((users) => {
    assertEquals(users.create("alice", "  Alice  ").name, "Alice");
    assertEquals(users.get("alice")?.name, "Alice");
  });
});

Deno.test("users: 同じ ID は UserExistsError で、元のユーザーは変わらない", () => {
  withUsers((users) => {
    users.create("alice", "Alice");
    const e = assertThrows(() => users.create("alice", "Another"), UserExistsError);
    assertInstanceOf(e, Error);
    assertEquals(users.get("alice")?.name, "Alice");
    assertEquals(users.list().length, 1);
  });
});

Deno.test("users: ID や名前が不正なら作らない", () => {
  withUsers((users) => {
    assertThrows(() => users.create("a b", "Alice"), Error, "ユーザー ID");
    assertThrows(() => users.create("alice", "   "), Error, "名前");
    assertEquals(users.list(), []);
  });
});

Deno.test("users: 一覧は作成の古い順（同時刻なら ID 順）", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare("INSERT INTO users (id, name, created_at) VALUES ('c', 'C', 1), ('a', 'A', 2), ('b', 'B', 2)").run();
    assertEquals(new UserRepo(db).list().map((u) => u.id), ["c", "a", "b"]);
  } finally {
    db.close();
  }
});
