import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { memorySessionStore, WakeClient } from "@wake-protocol/client";
import { getOrCreateWakeSecret } from "../src/db/meta.ts";
import { createEtHandler } from "../src/et/handler.ts";
import { createHttpApp } from "../src/http/app.ts";
import { createStationWake } from "../src/wake.ts";
import { createLoggedInUser, createTestStation, TEST_BASE_URL } from "./helpers/station.ts";

Deno.test("wake: secret は初回に作って meta に保存し、作り直さない", async () => {
  await using station = await createTestStation();
  const secret = getOrCreateWakeSecret(station.db);
  assertEquals(secret.length, 32);
  assertEquals(getOrCreateWakeSecret(station.db), secret);
});

Deno.test("wake: Station を再起動するとセッションは無効になるが、パスキーは残るのでログインし直せる", async () => {
  await using station = await createTestStation();
  const { auth } = await createLoggedInUser(station, "alice", "Alice");

  // ブラウザのセッション保存（IndexedDB に当たるもの）は再起動をまたいで残る
  const store = memorySessionStore();
  const before = new WakeClient({
    baseUrl: TEST_BASE_URL,
    getAssertion: auth.getAssertion,
    fetch: station.fetch,
    store,
  });
  await before.login({ mode: "discoverable" });
  assertEquals((await before.wakeFetch("wake://station/me")).status, 200);

  // 同じ DB で WAKE とアプリを作り直す（メモリの WakeStore は空になる）
  const etHandler = createEtHandler({ ...station });
  const wake = createStationWake({
    config: station.config,
    db: station.db,
    credentials: station.credentials,
    etHandler,
  });
  const restarted = createHttpApp({ ...station, wake });
  const restartedFetch: typeof fetch = async (input, init) => await restarted.fetch(new Request(input, init));

  const after = new WakeClient({
    baseUrl: TEST_BASE_URL,
    getAssertion: auth.getAssertion,
    fetch: restartedFetch,
    store,
  });
  await after.reload();
  assert(after.loggedIn);
  await assertRejects(() => after.wakeFetch("wake://station/me"));

  // ログインし直せば使える。署名のカウンターは DB に残っていて、続きから進む
  const fresh = new WakeClient({ baseUrl: TEST_BASE_URL, getAssertion: auth.getAssertion, fetch: restartedFetch });
  await fresh.login({ mode: "discoverable" });
  const me = await fresh.wakeFetch("wake://station/me");
  assertEquals(me.status, 200);
  assertEquals(await me.json(), { id: "alice", name: "Alice" });
  assertEquals(station.credentials.listByUser("alice")[0].signCount, auth.credentials[0].signCount);
  assertNotEquals(auth.credentials[0].signCount, 0);
});

Deno.test("wake: 同じパスキーの署名カウンターが戻ったら（複製の疑い）ログインできない", async () => {
  await using station = await createTestStation();
  const { auth } = await createLoggedInUser(station, "alice", "Alice");
  // 1 回ログイン済み（カウンター 1）。巻き戻した署名は拒否される
  auth.credentials[0].signCount = 0;
  await assertRejects(() => station.client(auth).login({ mode: "discoverable" }));
  // 正しく進めれば通る
  auth.credentials[0].signCount = 5;
  await station.client(auth).login({ mode: "discoverable" });
  assertEquals(station.credentials.listByUser("alice")[0].signCount, 6);
});
