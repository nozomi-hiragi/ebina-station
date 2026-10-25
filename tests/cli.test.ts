import { assert, assertEquals, assertMatch, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { addUser, type CliEnv, listUsers, registrationUrl, reissueToken, removeUser, runCli } from "../src/cli/main.ts";
import { renderQr } from "../src/cli/qr.ts";
import { SqliteCredentialStore } from "../src/accounts/credentials.ts";
import { openDatabase } from "../src/db/mod.ts";
import { RegistrationRepo } from "../src/accounts/registrations.ts";
import { UserExistsError, UserNotFoundError, UserRepo } from "../src/accounts/users.ts";
import { projectPaths } from "../src/paths.ts";
import { SoftAuthenticator } from "./helpers/authenticator.ts";
import {
  createLoggedInUser,
  createTestStation,
  registerPasskey,
  TEST_ORIGIN,
  testConfig,
  testConfigJson,
} from "./helpers/station.ts";

const config = testConfig();

Deno.test("cli: registrationUrl は frontURL/register?server=…&token=…（--with-code なら &code=…）", () => {
  assertEquals(
    registrationUrl(config, "TOKEN"),
    "http://localhost:5173/ebina-station/register?server=http%3A%2F%2Fstation.test&token=TOKEN",
  );
  assertEquals(
    registrationUrl(config, "TOKEN", "0042"),
    "http://localhost:5173/ebina-station/register?server=http%3A%2F%2Fstation.test&token=TOKEN&code=0042",
  );
  // serverURL に : / が含まれても encodeURIComponent される
  const c = testConfig({ serverURL: "https://station.example.com:8443/base" });
  assertStringIncludes(registrationUrl(c, "T"), "server=https%3A%2F%2Fstation.example.com%3A8443%2Fbase&token=T");
});

Deno.test("cli: addUser はユーザーと登録トークンを作る。URL には既定で確認コードを入れない", () => {
  const db = openDatabase(":memory:");
  try {
    const ctx = { config, db };
    const issued = addUser(ctx, "alice", "  Alice  ");
    assertEquals(issued.user.id, "alice");
    assertEquals(issued.user.name, "Alice");
    assertMatch(issued.token, /^[A-Za-z0-9_-]{43}$/);
    assertMatch(issued.code, /^\d{4}$/);
    assert(!issued.url.includes("code="));
    assertStringIncludes(issued.url, `token=${issued.token}`);
    assert(issued.expiresAt > Date.now());

    const registrations = new RegistrationRepo(db);
    assertEquals(registrations.get(issued.token)?.user.id, "alice");
    assertEquals(registrations.checkCode(issued.token, issued.code), { status: "ok" });

    const withCode = addUser(ctx, "bob", "Bob", { withCode: true });
    assertStringIncludes(withCode.url, `&code=${withCode.code}`);
  } finally {
    db.close();
  }
});

Deno.test("cli: addUser は重複や不正な入力で何も作らない", () => {
  const db = openDatabase(":memory:");
  try {
    const ctx = { config, db };
    addUser(ctx, "alice", "Alice");
    const tokens = () => db.prepare("SELECT COUNT(*) AS n FROM registration_tokens").get()?.n;
    assertEquals(tokens(), 1);
    assertThrows(() => addUser(ctx, "alice", "Other"), UserExistsError);
    assertThrows(() => addUser(ctx, "bad id", "X"), Error);
    assertThrows(() => addUser(ctx, "carol", "   "), Error);
    assertEquals(new UserRepo(db).list().map((u) => u.id), ["alice"]);
    assertEquals(tokens(), 1);
  } finally {
    db.close();
  }
});

Deno.test("cli: addUser は、トークンの発行で失敗したらユーザーも作らない（1 つのトランザクション）", () => {
  const db = openDatabase(":memory:");
  try {
    // 時計が例外を投げるとトークンの発行で失敗する
    const ctx = {
      config,
      db,
      now: () => {
        throw new Error("clock broke");
      },
    };
    assertThrows(() => addUser(ctx, "alice", "Alice"), Error, "clock broke");
    assertEquals(new UserRepo(db).list(), []);
    assertEquals(db.isTransaction, false);
  } finally {
    db.close();
  }
});

Deno.test("cli: reissueToken は既存のユーザーに新しいトークンを出す。いなければ UserNotFoundError", () => {
  const db = openDatabase(":memory:");
  try {
    const ctx = { config, db };
    const first = addUser(ctx, "alice", "Alice");
    const second = reissueToken(ctx, "alice", { withCode: true });
    assert(first.token !== second.token);
    assertStringIncludes(second.url, `&code=${second.code}`);
    // 発行し直すと、最初の未使用トークンは無効になる
    const registrations = new RegistrationRepo(db);
    assertEquals(registrations.get(first.token), undefined);
    assert(registrations.get(second.token));
    assertThrows(() => reissueToken(ctx, "ghost"), UserNotFoundError);
  } finally {
    db.close();
  }
});

Deno.test("cli: listUsers はパスキーの数を数え、removeUser はパスキーとトークンも消す", async () => {
  await using station = await createTestStation();
  await createLoggedInUser(station, "alice", "Alice");
  addUser({ config: station.config, db: station.db }, "bob", "Bob");

  assertEquals(listUsers(station.db).map((r) => [r.user.id, r.passkeys]), [["alice", 1], ["bob", 0]]);
  assertEquals(removeUser(station.db, "ghost"), false);
  assertEquals(removeUser(station.db, "alice"), true);
  assertEquals(listUsers(station.db).map((r) => r.user.id), ["bob"]);
  assertEquals(station.credentials.listByUser("alice"), []);
  assertEquals(removeUser(station.db, "bob"), true);
  const tokens = station.db.prepare("SELECT COUNT(*) AS n FROM registration_tokens").get()?.n;
  assertEquals(tokens, 0);
});

// ---- runCli ----

interface CapturedEnv extends CliEnv {
  stdout: string[];
  stderr: string[];
  confirms: string[];
}

function captureEnv(root: string, answers: { confirm?: boolean } = {}): CapturedEnv {
  const env: CapturedEnv = {
    projectRoot: root,
    stdout: [],
    stderr: [],
    confirms: [],
    out: (text) => env.stdout.push(text),
    err: (text) => env.stderr.push(text),
    confirm: (message) => {
      env.confirms.push(message);
      return answers.confirm ?? false;
    },
    renderQr: (url) => Promise.resolve(`[QR ${url}]\n`),
  };
  return env;
}

async function withProject(fn: (root: string) => Promise<void>, station = true): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "ebina-station-cli-" });
  try {
    if (station) await Deno.writeTextFile(projectPaths(root).config, JSON.stringify(testConfigJson()));
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/** CLI の別の接続から DB を読む（Station が使う接続と同じ状況） */
function queryDb<T>(root: string, fn: (db: ReturnType<typeof openDatabase>) => T): T {
  const db = openDatabase(projectPaths(root).db);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

Deno.test("cli runCli: add は URL・QR・確認コード・有効期限を出し、DB に保存する", () =>
  withProject(async (root) => {
    const env = captureEnv(root);
    assertEquals(await runCli(["add", "alice", "Alice Smith"], env), 0);
    assertEquals(env.stderr, []);
    const out = env.stdout.join("\n");
    assertStringIncludes(out, "ユーザー alice（Alice Smith）を作成しました。");
    const url = env.stdout.find((l) => l.startsWith("http://localhost:5173/ebina-station/register?"));
    assert(url !== undefined);
    assert(!url.includes("code="));
    assertStringIncludes(out, `[QR ${url}]`);
    const code = out.match(/確認コード: (\d{4})/)?.[1];
    assert(code !== undefined);
    assertMatch(out, /有効期限: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);

    const token = new URL(url).searchParams.get("token");
    assert(token);
    assertEquals(new URL(url).searchParams.get("server"), "http://station.test");
    queryDb(root, (db) => {
      const registrations = new RegistrationRepo(db);
      assertEquals(registrations.get(token)?.user, {
        id: "alice",
        name: "Alice Smith",
        createdAt: new UserRepo(db).get("alice")?.createdAt,
      });
      assertEquals(registrations.checkCode(token, code), { status: "ok" });
    });
  }));

Deno.test("cli runCli: add --with-code は URL に確認コードを入れる", () =>
  withProject(async (root) => {
    const env = captureEnv(root);
    assertEquals(await runCli(["add", "alice", "Alice", "--with-code"], env), 0);
    const out = env.stdout.join("\n");
    const url = env.stdout.find((l) => l.startsWith("http://"));
    assert(url !== undefined);
    const code = out.match(/確認コード: (\d{4})/)?.[1];
    assertEquals(new URL(url).searchParams.get("code"), code);
  }));

Deno.test("cli runCli: token は既存のユーザーに登録 URL を発行し直す。いなければ 1", () =>
  withProject(async (root) => {
    assertEquals(await runCli(["add", "alice", "Alice"], captureEnv(root)), 0);
    const env = captureEnv(root);
    assertEquals(await runCli(["token", "alice", "--with-code"], env), 0);
    assertStringIncludes(env.stdout.join("\n"), "ユーザー alice（Alice）の登録 URL を発行しました。");
    assert(env.stdout.some((l) => l.includes("&code=")));

    const missing = captureEnv(root);
    assertEquals(await runCli(["token", "ghost"], missing), 1);
    assertStringIncludes(missing.stderr.join("\n"), "ユーザー ghost が見つかりません");
  }));

Deno.test("cli runCli: list は ID・名前・パスキー数を揃えて出す", () =>
  withProject(async (root) => {
    // DB は Station か add が作る。空の DB ならユーザーはいない
    queryDb(root, () => {});
    const empty = captureEnv(root);
    assertEquals(await runCli(["list"], empty), 0);
    assertEquals(empty.stdout, ["ユーザーはいません"]);

    await runCli(["add", "alice", "アリス"], captureEnv(root));
    await runCli(["add", "bob-long-id", "Bob"], captureEnv(root));
    const env = captureEnv(root);
    assertEquals(await runCli(["list"], env), 0);
    assertEquals(env.stdout, [
      "ID           名前    パスキー",
      "alice        アリス  0",
      "bob-long-id  Bob     0",
    ]);
  }));

Deno.test("cli runCli: list と remove は、DB が無いと作らず、見た場所と EBINA_PROJECT_DIR を案内して 1", () =>
  withProject(async (root) => {
    for (const args of [["list"], ["remove", "alice", "--yes"]]) {
      const env = captureEnv(root);
      assertEquals(await runCli(args, env), 1);
      assertEquals(env.stdout, []);
      const err = env.stderr.join("\n");
      assertStringIncludes(err, projectPaths(root).db);
      assertStringIncludes(err, "EBINA_PROJECT_DIR");
    }
    // 空の DB もフォルダも作られていない
    await assertRejects(() => Deno.stat(projectPaths(root).db), Deno.errors.NotFound);
    await assertRejects(() => Deno.stat(join(root, "data")), Deno.errors.NotFound);
  }, false));

Deno.test("cli runCli: add と token は station.json を要求し、DB を作る", () =>
  withProject(async (root) => {
    await assertRejects(() => Deno.stat(projectPaths(root).db), Deno.errors.NotFound);
    assertEquals(await runCli(["add", "alice", "Alice"], captureEnv(root)), 0);
    await Deno.stat(projectPaths(root).db);
  }));

Deno.test("cli runCli: remove は確認を求め、はいなら消す。--yes なら確認しない", () =>
  withProject(async (root) => {
    await runCli(["add", "alice", "Alice"], captureEnv(root));
    await runCli(["add", "bob", "Bob"], captureEnv(root));

    // いいえ
    const no = captureEnv(root, { confirm: false });
    assertEquals(await runCli(["remove", "alice"], no), 1);
    assertEquals(no.confirms.length, 1);
    assertStringIncludes(no.confirms[0], "alice");
    assertStringIncludes(no.stderr.join("\n"), "中止しました");
    assertEquals(queryDb(root, (db) => new UserRepo(db).list().map((u) => u.id)), ["alice", "bob"]);

    // はい
    const yes = captureEnv(root, { confirm: true });
    assertEquals(await runCli(["remove", "alice"], yes), 0);
    assertStringIncludes(yes.stdout.join("\n"), "ユーザー alice（Alice）を消しました。");
    assertEquals(queryDb(root, (db) => new UserRepo(db).list().map((u) => u.id)), ["bob"]);

    // --yes
    const forced = captureEnv(root, { confirm: false });
    assertEquals(await runCli(["remove", "bob", "--yes"], forced), 0);
    assertEquals(forced.confirms, []);
    assertEquals(queryDb(root, (db) => new UserRepo(db).list()), []);

    // いない
    const ghost = captureEnv(root);
    assertEquals(await runCli(["remove", "bob", "--yes"], ghost), 1);
    assertStringIncludes(ghost.stderr.join("\n"), "ユーザー bob が見つかりません");
    assertEquals(ghost.confirms, []);
  }));

Deno.test("cli runCli: 使い方の誤りは 2。使い方を標準エラーに出す", () =>
  withProject(async (root) => {
    const cases: string[][] = [
      [],
      ["unknown"],
      ["add"],
      ["add", "alice"],
      ["add", "alice", "Alice", "extra"],
      ["add", "alice", "Alice", "--bogus"],
      ["add", "alice", "Alice", "--yes"],
      ["token"],
      ["token", "alice", "bob"],
      ["token", "alice", "--yes"],
      ["list", "extra"],
      ["list", "--with-code"],
      ["remove"],
      ["remove", "alice", "bob"],
      ["remove", "alice", "--with-code"],
      // 値の形式が正しくない
      ["add", "bad id", "Alice"],
      ["add", "alice", " "],
      ["add", "a".repeat(65), "Alice"],
      ["token", "bad/id"],
      ["remove", "bad id"],
    ];
    for (const args of cases) {
      const env = captureEnv(root);
      assertEquals(await runCli(args, env), 2, JSON.stringify(args));
      const err = env.stderr.join("\n");
      assertStringIncludes(err, "エラー:", JSON.stringify(args));
      assertStringIncludes(err, "使い方: deno task user", JSON.stringify(args));
      assertEquals(env.stdout, [], JSON.stringify(args));
    }
    // どれもユーザーを作っていない
    assertEquals(queryDb(root, (db) => new UserRepo(db).list()), []);
  }));

Deno.test("cli runCli: --help / help は 0 で使い方を標準出力に出す", () =>
  withProject(async (root) => {
    for (const args of [["--help"], ["-h"], ["help"], ["add", "--help"], ["list", "-h"]]) {
      const env = captureEnv(root);
      assertEquals(await runCli(args, env), 0, JSON.stringify(args));
      assertStringIncludes(env.stdout.join("\n"), "使い方: deno task user");
      assertEquals(env.stderr, []);
    }
  }));

Deno.test("cli runCli: 重複したユーザーは 1。station.json が無い／不正でも 1 で理由を出す", () =>
  withProject(async (root) => {
    await runCli(["add", "alice", "Alice"], captureEnv(root));
    const dup = captureEnv(root);
    assertEquals(await runCli(["add", "alice", "Other"], dup), 1);
    assertStringIncludes(dup.stderr.join("\n"), "ユーザー alice はすでにあります");

    await Deno.writeTextFile(projectPaths(root).config, JSON.stringify({ port: 0 }));
    const bad = captureEnv(root);
    assertEquals(await runCli(["add", "bob", "Bob"], bad), 1);
    assertStringIncludes(bad.stderr.join("\n"), "port");
    // list / remove は station.json を読まないので、設定が壊れていても使える
    const list = captureEnv(root);
    assertEquals(await runCli(["list"], list), 0);
    assertEquals(queryDb(root, (db) => new UserRepo(db).list().map((u) => u.id)), ["alice"]);
  }));

Deno.test("cli runCli: station.json が無いと add は 1 で、DB も作らない", () =>
  withProject(async (root) => {
    const env = captureEnv(root);
    assertEquals(await runCli(["add", "alice", "Alice"], env), 1);
    assertStringIncludes(env.stderr.join("\n"), "設定ファイルが見つかりません");
    assertStringIncludes(env.stderr.join("\n"), "examples/station.json");
    await assertRejects(() => Deno.stat(projectPaths(root).db), Deno.errors.NotFound);
  }, false));

Deno.test("cli runCli: 動いている Station と同じ DB に書いても、Station 側から見える", async () => {
  await using station = await createTestStation();
  const env = captureEnv(station.paths.root);
  assertEquals(await runCli(["add", "alice", "Alice"], env), 0);
  const url = env.stdout.find((l) => l.startsWith("http://"));
  assert(url !== undefined);
  const token = new URL(url).searchParams.get("token");
  assert(token);

  // Station の接続（station.db）から、CLI が発行したトークンで登録 API が使える
  assertEquals(await station.json(`/register/info?token=${token}`), {
    status: 200,
    body: { id: "alice", name: "Alice" },
  });
  assertEquals(station.users.get("alice")?.name, "Alice");

  // Station の接続で登録したパスキーを、CLI が数える
  const code = env.stdout.join("\n").match(/確認コード: (\d{4})/)?.[1];
  assert(code);
  await registerPasskey(station, new SoftAuthenticator(TEST_ORIGIN), { token, code });
  const listEnv = captureEnv(station.paths.root);
  assertEquals(await runCli(["list"], listEnv), 0);
  assertEquals(listEnv.stdout, ["ID     名前   パスキー", "alice  Alice  1"]);

  // CLI で消すと、Station の接続からも消えている
  assertEquals(await runCli(["remove", "alice", "--yes"], captureEnv(station.paths.root)), 0);
  assertEquals(station.users.get("alice"), undefined);
  assertEquals(new SqliteCredentialStore(station.db).listByUser("alice"), []);
});

Deno.test("cli qr: renderQr は端末向けの QR（複数行の文字列）を返す", async () => {
  const qr = await renderQr("http://localhost:5173/ebina-station/register?server=x&token=y");
  assert(qr.split("\n").length > 5);
  assertMatch(qr, /[▀▄█]/);
});

Deno.test("cli: DB の場所は project/data/station/station.db（フォルダが無ければ作る）", () =>
  withProject(async (root) => {
    await runCli(["add", "alice", "Alice"], captureEnv(root));
    assertEquals(projectPaths(root).db, join(root, "data", "station", "station.db"));
    const stat = await Deno.stat(projectPaths(root).db);
    assert(stat.isFile);
  }));
