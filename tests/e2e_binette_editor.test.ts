// 同梱の Binette エディタ（apps/binette-editor）を本物の子プロセスで動かし、
// パスキーでログインした WakeClient から、画面・API・プレビュー・asset まで届くことを確かめる。
// 子プロセスは createTestStation が close() で止める（await using）
import { assert, assertEquals, assertMatch } from "@std/assert";
import { parseBinette } from "@binette/core";
import { join } from "@std/path";
import { createLoggedInUser, createTestStation } from "./helpers/station.ts";

const PAGE = JSON.stringify({
  binette: "0.1",
  title: "プレビュー",
  entry: "main",
  assets: { main: { type: "html", content: "<p>こんにちは</p>" } },
});

const BASE = "wake://station/binette-editor";

Deno.test("e2e: 同梱の binette-editor が起動し、入口の一覧に出る", async () => {
  await using station = await createTestStation({ bundled: true });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  const info = station.hub.get("binette-editor");
  assertEquals(info?.status, "running");
  assertEquals(info?.label, "Binette エディタ");
  assertEquals(info?.kind, "embedded");

  const entrance = parseBinette(await (await client.wakeFetch("wake://station/index.bina")).text());
  const code = entrance.assets.main.content ?? "";
  assert(code.includes('"name":"binette-editor"'));
  assert(code.includes("Binette エディタ"));
  assert(code.includes("📝"));
});

Deno.test("e2e: 一覧・編集の画面と js・css の asset を配る", async () => {
  await using station = await createTestStation({ bundled: true });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  // 一覧の画面（entry が 404 を返し、Station が panoplie/ から探す）
  const list = await client.wakeFetch(`${BASE}.bina`);
  assertEquals(list.status, 200);
  const listBinette = parseBinette(await list.text());
  assertEquals(listBinette.entry, "main");
  assertEquals(listBinette.assets.main, { type: "js", src: "/binette-editor/files/list.js" });

  const edit = parseBinette(await (await client.wakeFetch(`${BASE}/edit.bina`)).text());
  assertEquals(edit.assets.main, { type: "js", src: "/binette-editor/files/edit.js" });

  // asset の src は ET で取れる。js は mount を export する
  for (const [binette, type] of [[listBinette, "text/javascript"], [edit, "text/javascript"]] as const) {
    const asset = binette.assets.main;
    assert(asset.src !== undefined);
    const res = await client.wakeFetch(`wake://station${asset.src}`);
    assertEquals(res.status, 200);
    assertMatch(res.headers.get("content-type") ?? "", new RegExp(`^${type}`));
    assertMatch(await res.text(), /export function mount\(el, sh\)/);
  }
  const css = await client.wakeFetch(`${BASE}/files/editor.css`);
  assertEquals(css.status, 200);
  assertMatch(css.headers.get("content-type") ?? "", /^text\/css/);
  await css.body?.cancel();
  assertEquals((await client.wakeFetch(`${BASE}/files/none.js`)).status, 404);

  // 画面は読むだけ（GET と HEAD 以外は子プロセスが 404 を返し、panoplie/ には探しに行かない）
  assertEquals((await client.wakeFetch(`${BASE}.bina`, { method: "POST", body: "x" })).status, 404);
});

Deno.test("e2e: API で作成・一覧・取得・上書き・削除でき、データフォルダに保存される", async () => {
  await using station = await createTestStation({ bundled: true });
  const { client } = await createLoggedInUser(station, "alice", "Alice");
  const api = (path: string, init?: Parameters<typeof client.wakeFetch>[1]) =>
    client.wakeFetch(`${BASE}/api/binettes${path}`, init);

  assertEquals(await (await api("")).json(), { names: [] });

  let res = await api("/notes/hello", { method: "PUT", body: PAGE });
  assertEquals(res.status, 201);
  assertEquals(await res.json(), { name: "notes/hello" });
  assertEquals((await api("/memo", { method: "PUT", body: PAGE })).status, 201);
  assertEquals(await (await api("")).json(), { names: ["memo", "notes/hello"] });

  // 保存先はアプリのデータフォルダ（Station の project/data/apps/binette-editor/binette）
  const saved = join(station.paths.appDataDir("binette-editor"), "binette", "notes", "hello.bina");
  assertEquals(await Deno.readTextFile(saved), PAGE);
  // 同梱のアプリのデータフォルダも project/data/apps/<名前> に 0700 で作られる
  const dataDir = station.paths.appDataDir("binette-editor");
  assertEquals(dataDir, join(station.paths.root, "data", "apps", "binette-editor"));
  assertEquals((await Deno.stat(dataDir)).mode! & 0o777, 0o700);

  res = await api("/notes/hello");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), PAGE);

  const updated = JSON.stringify({ binette: "0.1", redirect: "/memo" });
  assertEquals((await api("/notes/hello", { method: "PUT", body: updated })).status, 200);
  assertEquals(await (await api("/notes/hello")).text(), updated);

  // 検査エラー・名前の誤り・無いもの
  res = await api("/bad", { method: "PUT", body: "{" });
  assertEquals(res.status, 400);
  assert(typeof (await res.json() as { error: unknown }).error === "string");
  assertEquals((await api("/a.bina", { method: "PUT", body: PAGE })).status, 400);
  assertEquals((await api("/none")).status, 404);

  assertEquals((await api("/notes/hello", { method: "DELETE" })).status, 200);
  assertEquals((await api("/notes/hello", { method: "DELETE" })).status, 404);
  assertEquals(await (await api("")).json(), { names: ["memo"] });
  await Deno.stat(join(station.paths.appDataDir("binette-editor"), "binette", "notes")).then(
    () => assert(false, "空のフォルダが残っている"),
    (error) => assert(error instanceof Deno.errors.NotFound),
  );
});

Deno.test("e2e: プレビューは保存したビネットを .bina として返す", async () => {
  await using station = await createTestStation({ bundled: true });
  const { client } = await createLoggedInUser(station, "alice", "Alice");

  assertEquals((await client.wakeFetch(`${BASE}/api/binettes/notes/hello`, { method: "PUT", body: PAGE })).status, 201);
  const res = await client.wakeFetch(`${BASE}/preview/notes/hello.bina`);
  assertEquals(res.status, 200);
  assertMatch(res.headers.get("content-type") ?? "", /^application\/json/);
  const text = await res.text();
  assertEquals(text, PAGE);
  assertEquals(parseBinette(text).title, "プレビュー");

  assertEquals((await client.wakeFetch(`${BASE}/preview/none.bina`)).status, 404);
  assertEquals((await client.wakeFetch(`${BASE}/preview/notes/hello`)).status, 404);
});
