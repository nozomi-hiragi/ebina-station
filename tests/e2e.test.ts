import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { parseBinette } from "@binette/core";
import { addUser, reissueToken } from "../src/cli/main.ts";
import { etJson } from "../src/et/respond.ts";
import { b64url, fromB64url, SoftAuthenticator } from "./helpers/authenticator.ts";
import {
  createFakeHub,
  createLoggedInUser,
  createTestStation,
  fakeApp,
  registerPasskey,
  TEST_ORIGIN,
} from "./helpers/station.ts";

function newAuthenticator(): SoftAuthenticator {
  return new SoftAuthenticator(TEST_ORIGIN);
}

Deno.test("e2e 1: 登録 URL からパスキーを登録できる。トークンの再利用は 404", async () => {
  await using station = await createTestStation();
  const auth = newAuthenticator();
  const issued = addUser({ config: station.config, db: station.db }, "alice", "Alice");
  assertEquals(
    issued.url,
    `http://localhost:5173/ebina-station/register?server=${
      encodeURIComponent("http://station.test")
    }&token=${issued.token}`,
  );

  // info
  const info = await station.json(`/register/info?token=${issued.token}`);
  assertEquals(info, { status: 200, body: { id: "alice", name: "Alice" } });

  // options: 確認コードが違う
  const wrongCode = issued.code === "0000" ? "0001" : "0000";
  const wrong = await station.json("/register/options", { body: { token: issued.token, code: wrongCode } });
  assertEquals(wrong.status, 403);
  assertEquals(wrong.body, { error: "確認コードが違います（残り 4 回）", remaining: 4 });

  // options: 正しい確認コード
  const optionsRes = await station.json("/register/options", { body: { token: issued.token, code: issued.code } });
  assertEquals(optionsRes.status, 200);
  const options = optionsRes.body as {
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    challenge: string;
    pubKeyCredParams: { alg: number }[];
    authenticatorSelection: { residentKey: string; userVerification: string };
    attestation: string;
  };
  assertEquals(options.rp, { id: "localhost", name: "EbinaStation" });
  assertEquals(new TextDecoder().decode(fromB64url(options.user.id)), "alice");
  assertEquals(options.user.name, "alice");
  assertEquals(options.user.displayName, "Alice");
  assertEquals(options.pubKeyCredParams.map((p) => p.alg), [-7]);
  assertEquals(options.authenticatorSelection.residentKey, "required");
  assertEquals(options.authenticatorSelection.userVerification, "required");
  assertEquals(options.attestation, "none");

  // verify
  const response = await auth.register(options);
  const verify = await station.json("/register/verify", { body: { token: issued.token, response } });
  assertEquals(verify, { status: 200, body: { ok: true } });

  // 保存された内容
  const saved = station.credentials.listByUser("alice");
  assertEquals(saved.length, 1);
  assertEquals(saved[0].status, "active");
  assertEquals(saved[0].algorithm, -7);
  assertEquals(saved[0].signCount, 0);
  assertEquals(saved[0].transports, ["internal"]);
  assertEquals(new TextDecoder().decode(saved[0].userHandle), "alice");
  assertEquals(saved[0].publicKey, fromB64url(response.response.publicKey));
  assertEquals(saved[0].credentialId, fromB64url(response.rawId));

  // 同じトークンは使えない
  for (
    const [path, body] of [
      [`/register/info?token=${issued.token}`, undefined],
      ["/register/options", { token: issued.token, code: issued.code }],
      ["/register/verify", { token: issued.token, response }],
    ] as const
  ) {
    const res = await station.json(path, body === undefined ? {} : { body });
    assertEquals(res.status, 404, path);
    assertEquals(res.body, { error: "登録トークンが無効か、期限切れです" }, path);
  }
  assertEquals(station.credentials.listByUser("alice").length, 1);
});

Deno.test("e2e 1: 確認コードを 5 回間違えるとトークンが無効になる", async () => {
  await using station = await createTestStation();
  const issued = addUser({ config: station.config, db: station.db }, "alice", "Alice");
  const wrongCode = issued.code === "0000" ? "0001" : "0000";
  for (let remaining = 4; remaining >= 0; remaining--) {
    const res = await station.json("/register/options", { body: { token: issued.token, code: wrongCode } });
    assertEquals(res.status, 403);
    assertEquals(res.body, { error: `確認コードが違います（残り ${remaining} 回）`, remaining });
  }
  // 正しいコードでも、もう使えない
  const res = await station.json("/register/options", { body: { token: issued.token, code: issued.code } });
  assertEquals(res.status, 404);
});

Deno.test("e2e 1: 2 つ目のパスキーを足せる（token で再発行し、除外リストに最初のパスキーが入る）", async () => {
  await using station = await createTestStation();
  const first = newAuthenticator();
  const issued = addUser({ config: station.config, db: station.db }, "alice", "Alice");
  await registerPasskey(station, first, issued);

  const again = reissueToken({ config: station.config, db: station.db }, "alice");
  assertNotEquals(again.token, issued.token);
  const optionsRes = await station.json("/register/options", { body: { token: again.token, code: again.code } });
  assertEquals(optionsRes.status, 200);
  const options = optionsRes.body as { excludeCredentials: { id: string }[] };
  assertEquals(options.excludeCredentials.map((c) => c.id), [b64url(first.credentials[0].id)]);

  // 別のパスキーなら登録でき、2 つになる
  const second = newAuthenticator();
  await registerPasskey(station, second, again);
  assertEquals(station.credentials.listByUser("alice").length, 2);
});

Deno.test("e2e 2: パスキーで WAKE にログインして wake://station/me を取れる", async () => {
  await using station = await createTestStation();
  const { client } = await createLoggedInUser(station, "alice", "Alice");
  assert(client.loggedIn);
  const res = await client.wakeFetch("wake://station/me");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals(await res.json(), { id: "alice", name: "Alice" });
});

Deno.test("e2e 2: ユーザー ID を指定したログインもできる。ログアウト後は ET が使えない", async () => {
  await using station = await createTestStation();
  const auth = newAuthenticator();
  const issued = addUser({ config: station.config, db: station.db }, "bob", "Bob");
  await registerPasskey(station, auth, issued);

  const client = station.client(auth);
  await client.login({ mode: "username", username: "bob" });
  assertEquals(await (await client.wakeFetch("wake://station/me")).json(), { id: "bob", name: "Bob" });

  // 2 回目のログインでは署名のカウンターが進んでいる（カウンターの検査を通る）
  const another = station.client(auth);
  await another.login({ mode: "discoverable" });
  assertEquals((await another.wakeFetch("wake://station/me")).status, 200);
  assertEquals(station.credentials.listByUser("bob")[0].signCount, 2);

  await client.logout();
  assert(!client.loggedIn);
});

Deno.test("e2e 2: 登録していないパスキーではログインできない", async () => {
  await using station = await createTestStation();
  await createLoggedInUser(station, "alice", "Alice");
  const stranger = newAuthenticator();
  // 別の authenticator は、このサーバーに登録されていない鍵で署名する
  const issued = addUser({ config: station.config, db: station.db }, "carol", "Carol");
  const optionsRes = await station.json("/register/options", { body: { token: issued.token, code: issued.code } });
  assertEquals(optionsRes.status, 200);
  await stranger.register(optionsRes.body as Parameters<SoftAuthenticator["register"]>[0]);
  let failed = false;
  try {
    await station.client(stranger).login({ mode: "discoverable" });
  } catch {
    failed = true;
  }
  assert(failed, "未登録のパスキーでログインできてしまった");
});

Deno.test("e2e 3: wake://station/index.bina は parseBinette に通る入口を返す", async () => {
  const hub = createFakeHub({
    apps: [fakeApp("notes", { label: "ノート", icon: "N" }), fakeApp("off", { enabled: false })],
  });
  await using station = await createTestStation({ hub });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  const res = await client.wakeFetch("wake://station/index.bina");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "application/json");
  const text = await res.text();
  const binette = parseBinette(text);
  assertEquals(binette.entry, "main");
  assertEquals(binette.settings, [{ order: 10, label: "アカウント", type: "element", component: "logout" }]);
  const main = binette.assets.main;
  assertEquals(main.type, "js");
  assertMatch(main.content ?? "", /"name":"notes"/);
  assert(!(main.content ?? "").includes('"name":"off"'), "無効なアプリが一覧に入っている");
  assertEquals(hub.calls.length, 0);
});

Deno.test("e2e 3: entrance.redirect があれば入口は転送になる", async () => {
  await using station = await createTestStation({ config: { entrance: { redirect: "/binette-editor" } } });
  const { client } = await createLoggedInUser(station, "alice", "Alice");
  const res = await client.wakeFetch("wake://station/index.bina");
  assertEquals(res.status, 200);
  const binette = parseBinette(await res.text());
  assertEquals(binette.redirect, "/binette-editor");
  assertEquals(binette.settings, [{ order: 10, label: "アカウント", type: "element", component: "logout" }]);
});

Deno.test("e2e 4(偽の AppHub): アプリへの中継は、名前を除いたパスとクエリ、メソッド、本文、ユーザーを渡す", async () => {
  const hub = createFakeHub({
    apps: [fakeApp("echo"), fakeApp("notes", { status: "stopped" })],
    respond: (call) =>
      call.path.startsWith("/hello")
        ? {
          status: 201,
          headers: [["content-type", "text/plain"], ["x-app", "yes"]],
          body: new TextEncoder().encode("done"),
        }
        : etJson(200, { path: call.path }),
  });
  await using station = await createTestStation({ hub });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  const res = await client.wakeFetch("wake://station/echo/hello?x=1", {
    method: "POST",
    headers: [["Ebina-User", "evil"], ["X-Test", "1"]],
    body: "abc",
  });
  assertEquals(res.status, 201);
  assertEquals(res.headers.get("x-app"), "yes");
  assertEquals(await res.text(), "done");

  assertEquals(hub.calls.length, 1);
  const call = hub.calls[0];
  assertEquals(call.name, "echo");
  assertEquals(call.path, "/hello?x=1");
  assertEquals(call.userId, "alice");
  assertEquals(call.req.method, "POST");
  assertEquals(new TextDecoder().decode(call.req.body), "abc");
  // ヘッダーの取捨は hub の仕事。ET の処理はクライアントが送ったものをそのまま渡す
  assert(call.req.headers.some(([n, v]) => n.toLowerCase() === "x-test" && v === "1"));

  // パスの対応
  const cases: [string, string, string][] = [
    ["wake://station/echo", "echo", "/"],
    ["wake://station/echo/", "echo", "/"],
    ["wake://station/echo?y=2", "echo", "/?y=2"],
    ["wake://station/echo.bina", "echo", "/index.bina"],
    ["wake://station/echo.bina?z=3", "echo", "/index.bina?z=3"],
    ["wake://station/notes/files/hello.txt", "notes", "/files/hello.txt"],
    ["wake://station/notes/a%20b/c", "notes", "/a%20b/c"],
  ];
  for (const [url, name, path] of cases) {
    hub.calls.length = 0;
    const r = await client.wakeFetch(url);
    assertEquals(r.status, 200, url);
    assertEquals(hub.calls.length, 1, url);
    assertEquals([hub.calls[0].name, hub.calls[0].path], [name, path], url);
  }
});

Deno.test("e2e 6: 予約名・不正なパス・無いアプリ", async () => {
  const hub = createFakeHub({ apps: [fakeApp("echo"), fakeApp("notes"), fakeApp("off", { enabled: false })] });
  await using station = await createTestStation({ hub });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  const get = async (url: string, method = "GET") => {
    const res = await client.wakeFetch(url, { method });
    return { status: res.status, body: await res.json() };
  };
  const notFound = { error: { code: "not_found" } };
  const invalidUrl = { error: { code: "invalid_url" } };

  // 404: 予約名、無いアプリ、無効なアプリ、規則に合わない名前、それ以外
  for (
    const url of [
      "wake://station/station",
      "wake://station/station/apps",
      "wake://station/station/api/x",
      "wake://station/settings.bina",
      "wake://station/settings/x",
      "wake://station/settings",
      "wake://station/ebina/auth/x",
      "wake://station/ebina",
      "wake://station/index",
      "wake://station/index/x",
      "wake://station/me/x",
      "wake://station/me.bina",
      "wake://station/nothere",
      "wake://station/nothere.bina",
      "wake://station/nothere/a/b",
      "wake://station/off",
      "wake://station/off.bina",
      "wake://station/off/x",
      "wake://station/Echo",
      "wake://station/echo.bina/x",
      "wake://station/",
      "wake://station",
      "wake://other/echo",
      "https://station/echo",
      "/echo",
    ]
  ) {
    assertEquals(await get(url), { status: 404, body: notFound }, url);
  }

  // 400: .  ..  空の区間  %2f  %5c
  for (
    const url of [
      "wake://station/echo/../x",
      "wake://station/echo/./x",
      "wake://station/echo/..",
      "wake://station/../echo",
      "wake://station/echo/%2e%2e/x",
      "wake://station/echo/%2E/x",
      "wake://station/echo/.%2e/x",
      "wake://station/echo//x",
      "wake://station//echo",
      "wake://station/echo/a//",
      "wake://station/echo/a%2fb",
      "wake://station/echo/a%2Fb",
      "wake://station/echo/a%5cb",
      "wake://station/echo/a%5Cb",
      "wake://station/echo%2fx",
      "wake://station/echo/%00",
      "wake://station/echo/%ff",
      "wake://station/station/../echo",
    ]
  ) {
    assertEquals(await get(url), { status: 400, body: invalidUrl }, url);
  }

  // 405
  assertEquals(await get("wake://station/me", "POST"), {
    status: 405,
    body: { error: { code: "method_not_allowed" } },
  });
  assertEquals(await get("wake://station/index.bina", "POST"), {
    status: 405,
    body: { error: { code: "method_not_allowed" } },
  });

  // どれもアプリには届いていない
  assertEquals(hub.calls.length, 0);
});

Deno.test("e2e 7: ユーザーを DB から消したあとの ET は 401", async () => {
  const hub = createFakeHub({ apps: [fakeApp("echo")] });
  await using station = await createTestStation({ hub });
  const { client } = await createLoggedInUser(station, "alice", "Alice");
  assertEquals((await client.wakeFetch("wake://station/me")).status, 200);

  assert(station.users.remove("alice"));
  for (const url of ["wake://station/me", "wake://station/index.bina", "wake://station/echo", "wake://station/zzz"]) {
    const res = await client.wakeFetch(url);
    assertEquals(res.status, 401, url);
    // ebina-front はこの印で Station のセッション切れを見分ける
    assertEquals(res.headers.get("ebina-station-error"), "unauthorized", url);
    assertEquals(await res.json(), { error: { code: "unauthorized" } }, url);
  }
  assertEquals(hub.calls.length, 0);
});

Deno.test("e2e 7: そのセッションのパスキーだけを消しても 401。別のパスキーのセッションは使える", async () => {
  await using station = await createTestStation();
  const { client, auth } = await createLoggedInUser(station, "alice", "Alice");
  // 2 つ目のパスキーでもログインしておく
  const second = newAuthenticator();
  const issued = reissueToken({ config: station.config, db: station.db }, "alice");
  await registerPasskey(station, second, issued);
  const client2 = station.client(second);
  await client2.login({ mode: "discoverable" });

  assert(station.credentials.remove(auth.credentials[0].id));
  assertEquals((await client.wakeFetch("wake://station/me")).status, 401);
  assertEquals((await client2.wakeFetch("wake://station/me")).status, 200);
});
