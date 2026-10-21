import { assert, assertEquals, assertMatch, assertNotEquals, assertThrows } from "@std/assert";
import { createHash } from "node:crypto";
import { openDatabase } from "../src/db/mod.ts";
import { MAX_CODE_ATTEMPTS, REGISTRATION_TTL_MS, RegistrationRepo } from "../src/db/registrations.ts";
import { UserNotFoundError, UserRepo } from "../src/db/users.ts";

/** 時計を進められるテスト用の環境 */
function setup() {
  const db = openDatabase(":memory:");
  const users = new UserRepo(db);
  const clock = { now: 1_700_000_000_000 };
  const registrations = new RegistrationRepo(db, () => clock.now);
  const alice = users.create("alice", "Alice");
  return { db, users, registrations, clock, alice };
}

function sha256Base64url(text: string): string {
  return createHash("sha256").update(text).digest("base64url");
}

function wrongCode(code: string): string {
  return code === "0000" ? "0001" : "0000";
}

Deno.test("registrations: 発行したトークンと確認コードの形", () => {
  const { db, registrations, clock } = setup();
  try {
    const issued = registrations.issue("alice");
    assertMatch(issued.token, /^[A-Za-z0-9_-]{43}$/);
    assertMatch(issued.code, /^\d{4}$/);
    assertEquals(issued.expiresAt, clock.now + REGISTRATION_TTL_MS);
    assertEquals(REGISTRATION_TTL_MS, 15 * 60 * 1000);
    const other = registrations.issue("alice");
    assertNotEquals(other.token, issued.token);
  } finally {
    db.close();
  }
});

Deno.test("registrations: DB にはトークンのハッシュだけを保存し、平文は残さない", () => {
  const { db, registrations } = setup();
  try {
    const { token, code } = registrations.issue("alice");
    const rows = db.prepare("SELECT * FROM registration_tokens").all();
    assertEquals(rows.length, 1);
    assertEquals(rows[0].token_hash, sha256Base64url(token));
    assertNotEquals(rows[0].token_hash, token);
    assertEquals(rows[0].code, code);
    for (const value of Object.values(rows[0])) assertNotEquals(value, token);
    // どの列にもトークンの文字列が入っていない（ファイル全体としても）
    const dump = JSON.stringify(rows);
    assert(!dump.includes(token));
  } finally {
    db.close();
  }
});

Deno.test("registrations: get は有効なトークンのユーザーを返す", () => {
  const { db, registrations, alice } = setup();
  try {
    const { token } = registrations.issue("alice");
    assertEquals(registrations.get(token), { user: alice });
    assertEquals(registrations.get("unknown-token"), undefined);
    assertEquals(registrations.get(""), undefined);
    assertEquals(registrations.get("x".repeat(100_000)), undefined);
    assertEquals(registrations.get(undefined as unknown as string), undefined);
  } finally {
    db.close();
  }
});

Deno.test("registrations: 15 分たつと使えない", () => {
  const { db, registrations, clock } = setup();
  try {
    const { token, code } = registrations.issue("alice");
    clock.now += REGISTRATION_TTL_MS - 1;
    assert(registrations.get(token));
    assertEquals(registrations.checkCode(token, code), { status: "ok" });
    clock.now += 1; // ちょうど期限
    assertEquals(registrations.get(token), undefined);
    assertEquals(registrations.checkCode(token, code), { status: "invalid" });
    assertEquals(registrations.markUsed(token), false); // 期限切れは使用済みにもできない
    assertEquals(registrations.get(token), undefined);
  } finally {
    db.close();
  }
});

Deno.test("registrations: 確認コードの照合", () => {
  const { db, registrations } = setup();
  try {
    const { token, code } = registrations.issue("alice");
    assertEquals(registrations.checkCode(token, code), { status: "ok" });
    // 正しければ何度でも ok（使用済みにするのは markUsed）
    assertEquals(registrations.checkCode(token, code), { status: "ok" });
    assertEquals(registrations.checkCode("unknown", code), { status: "invalid" });
    assertEquals(registrations.checkCode(token, undefined as unknown as string), {
      status: "wrong",
      remaining: MAX_CODE_ATTEMPTS - 1,
    });
  } finally {
    db.close();
  }
});

Deno.test("registrations: 間違いは 5 回までで、超えると正しいコードでも無効", () => {
  const { db, registrations } = setup();
  try {
    assertEquals(MAX_CODE_ATTEMPTS, 5);
    const { token, code } = registrations.issue("alice");
    const wrong = wrongCode(code);
    for (let i = 1; i <= 5; i++) {
      assertEquals(registrations.checkCode(token, wrong), { status: "wrong", remaining: 5 - i }, `${i} 回目`);
    }
    assertEquals(registrations.checkCode(token, code), { status: "invalid" });
    assertEquals(registrations.checkCode(token, wrong), { status: "invalid" });
    assertEquals(registrations.get(token), undefined);
  } finally {
    db.close();
  }
});

Deno.test("registrations: 桁数の違うコードや空のコードも間違いとして数える", () => {
  const { db, registrations } = setup();
  try {
    const { token, code } = registrations.issue("alice");
    assertEquals(registrations.checkCode(token, ""), { status: "wrong", remaining: 4 });
    assertEquals(registrations.checkCode(token, code + "0"), { status: "wrong", remaining: 3 });
    assertEquals(registrations.checkCode(token, code), { status: "ok" });
  } finally {
    db.close();
  }
});

Deno.test("registrations: トークンごとに間違いの回数は別", () => {
  const { db, registrations } = setup();
  try {
    const a = registrations.issue("alice");
    const b = registrations.issue("alice");
    for (let i = 0; i < 5; i++) registrations.checkCode(a.token, wrongCode(a.code));
    assertEquals(registrations.checkCode(a.token, a.code), { status: "invalid" });
    assertEquals(registrations.checkCode(b.token, b.code), { status: "ok" });
  } finally {
    db.close();
  }
});

Deno.test("registrations: challenge を覚え、get で返す", () => {
  const { db, registrations } = setup();
  try {
    const { token } = registrations.issue("alice");
    assertEquals(registrations.get(token)?.challenge, undefined);
    registrations.setChallenge(token, "challenge-1");
    assertEquals(registrations.get(token)?.challenge, "challenge-1");
    registrations.setChallenge(token, "challenge-2");
    assertEquals(registrations.get(token)?.challenge, "challenge-2");
    // 知らないトークンには何も起きない
    registrations.setChallenge("unknown", "x");
  } finally {
    db.close();
  }
});

Deno.test("registrations: clearChallenge は challenge を捨てる。使えないトークンには何もしない", () => {
  const { db, registrations } = setup();
  try {
    const { token } = registrations.issue("alice");
    registrations.setChallenge(token, "challenge-1");
    registrations.clearChallenge(token);
    assertEquals(registrations.get(token)?.challenge, undefined);
    // 捨てたあとも、トークンそのものは使える
    assertEquals(registrations.get(token)?.user.id, "alice");
    registrations.clearChallenge("unknown");
    registrations.clearChallenge("");
  } finally {
    db.close();
  }
});

Deno.test("registrations: markUsed は 1 回だけ true で、使用済みは再利用できない", () => {
  const { db, registrations } = setup();
  try {
    const { token, code } = registrations.issue("alice");
    assertEquals(registrations.markUsed(token), true);
    assertEquals(registrations.markUsed(token), false);
    assertEquals(registrations.get(token), undefined);
    assertEquals(registrations.checkCode(token, code), { status: "invalid" });
    // 使用済みのトークンに challenge は書かれない
    registrations.setChallenge(token, "late");
    assertEquals(db.prepare("SELECT challenge FROM registration_tokens").get()?.challenge, null);
    assertEquals(registrations.markUsed("unknown"), false);
  } finally {
    db.close();
  }
});

Deno.test("registrations: ユーザーがいなければ発行できない", () => {
  const { db, registrations } = setup();
  try {
    assertThrows(() => registrations.issue("nobody"), UserNotFoundError);
    assertEquals(db.prepare("SELECT COUNT(*) AS n FROM registration_tokens").get()?.n, 0);
  } finally {
    db.close();
  }
});

Deno.test("registrations: ユーザーを消すとトークンも無効になる", () => {
  const { db, users, registrations } = setup();
  try {
    const { token, code } = registrations.issue("alice");
    users.remove("alice");
    assertEquals(registrations.get(token), undefined);
    assertEquals(registrations.checkCode(token, code), { status: "invalid" });
  } finally {
    db.close();
  }
});

Deno.test("registrations: 発行のときに使えなくなった行を片付ける", () => {
  const { db, registrations, clock } = setup();
  try {
    const used = registrations.issue("alice");
    registrations.markUsed(used.token);
    const expired = registrations.issue("alice");
    clock.now += REGISTRATION_TTL_MS + 1;
    const live = registrations.issue("alice");
    const hashes = db.prepare("SELECT token_hash FROM registration_tokens").all().map((r) => String(r.token_hash));
    assertEquals(hashes, [sha256Base64url(live.token)]);
    assertEquals(registrations.get(used.token), undefined);
    assertEquals(registrations.get(expired.token), undefined);
    assert(registrations.get(live.token));
  } finally {
    db.close();
  }
});
