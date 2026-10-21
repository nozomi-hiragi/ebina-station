// e2e の 4・5: 本物の AppHub（子プロセス）を通す。パスキーでログインした WakeClient から、
// echo（entry あり）と notes（panoplie/ だけ）まで届くことを確かめる。
// 子プロセスは createTestStation が close() で止める（await using）
import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { parseBinette } from "@binette/core";
import { AppStateRepo } from "../src/db/app_states.ts";
import { writeApp } from "./fixtures/mod.ts";
import { createLoggedInUser, createTestStation } from "./helpers/station.ts";

interface EchoReply {
  method: string;
  path: string;
  body: string;
  headerNames: string[];
  headers: Record<string, string>;
  ebinaUser: string | null;
  hasAppToken: boolean;
}

interface Outcome {
  ok: boolean;
  error?: string;
}

Deno.test("e2e 4: echo アプリへ中継する（パス・クエリ・メソッド・本文・ユーザー・ヘッダー）", async () => {
  await using station = await createTestStation({ apps: ["echo", "notes"] });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  const res = await client.wakeFetch("wake://station/echo/hello?x=1", {
    method: "POST",
    // クライアントが名乗る Ebina-User は捨てられ、ログイン中のユーザーに置き換わる
    headers: [["Ebina-User", "evil"], ["Ebina-App-Token", "forged"], ["X-Test", "1"]],
    body: "abc",
  });
  assertEquals(res.status, 200);
  assertMatch(res.headers.get("content-type") ?? "", /^application\/json/);
  const echoed = await res.json() as EchoReply;
  assertEquals(echoed.method, "POST");
  assertEquals(echoed.path, "/hello?x=1");
  assertEquals(echoed.body, "abc");
  assertEquals(echoed.ebinaUser, "alice");
  assertEquals(echoed.headers["ebina-user"], "alice");
  assertEquals(echoed.headers["x-test"], "1");
  // 偽のトークンではなく、Station が付けたトークンが届いている（値は echo が返さないので、届いたかだけ分かる）
  assert(echoed.hasAppToken);
  assertEquals(echoed.headerNames.filter((name) => name === "ebina-user").length, 1);
  assertEquals(echoed.headerNames.filter((name) => name === "ebina-app-token").length, 1);

  // アプリ名を除いたパスになる
  const cases: [string, string][] = [
    ["wake://station/echo", "/"],
    ["wake://station/echo/", "/"],
    ["wake://station/echo?y=2", "/?y=2"],
    ["wake://station/echo.bina", "/index.bina"],
    ["wake://station/echo/a/b.bina?z=3", "/a/b.bina?z=3"],
  ];
  for (const [url, path] of cases) {
    const r = await client.wakeFetch(url);
    assertEquals(r.status, 200, url);
    const body = await r.json() as EchoReply;
    assertEquals([body.method, body.path, body.ebinaUser], ["GET", path, "alice"], url);
  }
});

Deno.test("e2e 4: アプリの応答のヘッダーは、Set-Cookie と Ebina- 始まりを除いて返る", async () => {
  await using station = await createTestStation({ apps: ["echo"] });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  const res = await client.wakeFetch("wake://station/echo/__probe/response-headers");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "headers");
  assertEquals(res.headers.get("x-visible"), "yes");
  assertEquals(res.headers.get("set-cookie"), null);
  assertEquals(res.headers.get("ebina-secret"), null);
});

Deno.test("e2e 4: 子プロセスは許された権限だけで動き、データフォルダに書ける", async () => {
  await using station = await createTestStation({ apps: ["echo"] });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  const write = await client.wakeFetch("wake://station/echo/__probe/write");
  assertEquals(await write.json(), { ok: true, content: "データフォルダに書けた" });

  const outside = await (await client.wakeFetch("wake://station/echo/__probe/write-outside")).json() as Outcome;
  assertEquals(outside.ok, false);
  const net = await (await client.wakeFetch("wake://station/echo/__probe/net")).json() as {
    external: Outcome;
    connect: Outcome;
  };
  assertEquals(net.external.ok, false);
  assertEquals(net.connect.ok, false);
});

Deno.test("e2e 4: 無効にしたアプリは 404、有効に戻して reload すると使える", async () => {
  await using station = await createTestStation({ apps: ["echo", "notes"] });
  const { client } = await createLoggedInUser(station, "alice", "Alice");
  const states = new AppStateRepo(station.db);

  assertEquals((await client.wakeFetch("wake://station/echo")).status, 200);

  states.setEnabled("echo", false);
  await station.hub.reload();
  for (const url of ["wake://station/echo", "wake://station/echo.bina", "wake://station/echo/hello"]) {
    const res = await client.wakeFetch(url);
    assertEquals(res.status, 404, url);
    assertEquals(await res.json(), { error: { code: "not_found" } }, url);
  }
  // 入口の一覧からも消える
  const entrance = parseBinette(await (await client.wakeFetch("wake://station/index.bina")).text());
  const list = entrance.assets.main.content ?? "";
  assert(!list.includes('"name":"echo"'));
  assert(list.includes('"name":"notes"'));

  states.setEnabled("echo", true);
  await station.hub.reload();
  assertEquals((await client.wakeFetch("wake://station/echo")).status, 200);
});

Deno.test("e2e 4: アプリの 401 はそのまま届き、Station の印は付かない。セッションは有効なまま", async () => {
  await using station = await createTestStation({ apps: ["echo"] });
  const { client } = await createLoggedInUser(station, "alice", "Alice");
  // Station 自身の 401 と同じ本文と印のヘッダーを返すアプリ
  await writeApp(station.paths, "guard", {
    "app.json": JSON.stringify({ label: "ガード", entry: "main.ts" }),
    "main.ts":
      `export default { fetch: () => Response.json({ error: { code: "unauthorized" } }, { status: 401, headers: { "Ebina-Station-Error": "unauthorized" } }) };`,
  });
  await station.hub.reload();

  for (const url of ["wake://station/guard", "wake://station/guard.bina", "wake://station/guard/api/x"]) {
    const res = await client.wakeFetch(url);
    assertEquals(res.status, 401, url);
    assertEquals(res.headers.get("ebina-station-error"), null, url);
    await res.body?.cancel();
  }
  assertEquals((await client.wakeFetch("wake://station/me")).status, 200);
});

Deno.test("e2e 5: panoplie/ だけのアプリ（notes）は子プロセス無しで配られる", async () => {
  await using station = await createTestStation({ apps: ["notes"] });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  const index = await client.wakeFetch("wake://station/notes.bina");
  assertEquals(index.status, 200);
  assertMatch(index.headers.get("content-type") ?? "", /^application\/json/);
  const binette = parseBinette(await index.text());
  assertEquals(binette.title, "メモ");

  const file = await client.wakeFetch("wake://station/notes/files/hello.txt");
  assertEquals(file.status, 200);
  assertEquals(await file.text(), "こんにちは、メモです。\n");

  // 無いファイルは 404、書き込み系は 405（Coulisses の応答）
  assertEquals((await client.wakeFetch("wake://station/notes/files/none.txt")).status, 404);
  assertEquals((await client.wakeFetch("wake://station/notes.bina", { method: "POST", body: "x" })).status, 405);
  // 子プロセスを持たないアプリは、起動を待たずに running
  assertEquals(station.hub.get("notes")?.status, "running");
});

Deno.test("e2e 5: 入口の一覧は本物の hub のアプリ（有効なものだけ）から作られる", async () => {
  await using station = await createTestStation({ apps: ["echo", "notes", "broken"] });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  const res = await client.wakeFetch("wake://station/index.bina");
  assertEquals(res.status, 200);
  const binette = parseBinette(await res.text());
  const content = binette.assets.main.content ?? "";
  assertMatch(content, /"name":"echo","label":"Echo","icon":"🔁"/);
  assertMatch(content, /"name":"notes","label":"Notes","icon":"📝"/);
  // 異常なアプリ（label が無い app.json）は、中継すると 503
  assertNotEquals(station.hub.get("broken")?.status, "running");
  const broken = await client.wakeFetch("wake://station/broken");
  assertEquals(broken.status, 503);
  assertEquals(await broken.json(), { error: { code: "app_unavailable" } });
});
