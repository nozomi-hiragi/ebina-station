// src/main.ts の startStation を、本物の HTTP サーバーと子プロセスで動かす
import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { WakeClient } from "@wake-protocol/client";
import { addUser, removeUser } from "../src/cli/main.ts";
import { ConfigError, parseStationConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/mod.ts";
import { PortInUseError, StartAborted, startStation } from "../src/main.ts";
import { SoftAuthenticator } from "./helpers/authenticator.ts";
import { jsonRequester, registerPasskey, TEST_ORIGIN, testConfigJson } from "./helpers/station.ts";
import { isProcessAlive, makeProject, type TestProject, waitFor, writeSilentApp } from "./fixtures/mod.ts";

/** テストでは外からつながらないよう 127.0.0.1 だけで待ち受け、ポートは OS に任せる */
// 同梱のアプリ（Binette エディタ）は使わない。ここで確かめたいのはテスト用のアプリだけ
const LOCAL = { hostname: "127.0.0.1", port: 0, bundledAppsDir: null };

/** station.json を置いた project（apps/ に fixtures を写してある） */
async function makeStationProject(apps: string[]): Promise<TestProject> {
  const project = await makeProject(apps);
  await Deno.writeTextFile(project.paths.config, JSON.stringify(testConfigJson()));
  return project;
}

Deno.test("main: 起動して HTTP で応える。404、CORS のプリフライト、止めたあとは接続できない", async () => {
  const project = await makeStationProject(["echo"]);
  const station = await startStation(project.paths, LOCAL);
  try {
    const base = `http://127.0.0.1:${station.port}`;

    // 無効な登録トークン
    const invalid = await fetch(`${base}/ebina/register/info?token=invalid`);
    assertEquals(invalid.status, 404);
    assertEquals(await invalid.json(), { error: "登録トークンが無効か、期限切れです" });

    // 知らないパス
    const unknown = await fetch(`${base}/nothing`);
    assertEquals(unknown.status, 404);
    assertEquals(await unknown.json(), { error: "見つかりません" });

    // 許可した origin からのプリフライト
    const preflight = await fetch(`${base}/ebina/register/options`, {
      method: "OPTIONS",
      headers: {
        Origin: TEST_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    await preflight.body?.cancel();
    assertEquals(preflight.status, 204);
    assertEquals(preflight.headers.get("access-control-allow-origin"), TEST_ORIGIN);
    assertMatch(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);
    assertMatch(preflight.headers.get("access-control-allow-headers") ?? "", /content-type/i);

    // 許可していない origin には許可を返さない
    const other = await fetch(`${base}/ebina/register/options`, {
      method: "OPTIONS",
      headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" },
    });
    await other.body?.cancel();
    assertEquals(other.headers.get("access-control-allow-origin"), null);

    // 止めるのは何度呼んでもよい
    await Promise.all([station.stop(), station.stop()]);
    await station.stop();
    await assertRejects(() => fetch(`${base}/ebina/register/info?token=invalid`));
  } finally {
    await station.stop();
    await project.dispose();
  }
});

Deno.test("main: 本物の HTTP でパスキーを登録し、ログインして、アプリまで届く。止めると子プロセスも止まる", async () => {
  const project = await makeStationProject(["echo", "notes"]);
  const station = await startStation(project.paths, LOCAL);
  let stopped = false;
  try {
    const base = `http://127.0.0.1:${station.port}/ebina`;
    const json = jsonRequester(fetch, base);

    // CLI は別のプロセスだが、同じ DB を別の接続で開いて操作する
    const config = parseStationConfig(testConfigJson());
    const cliDb = openDatabase(project.paths.db);
    try {
      const issued = addUser({ config, db: cliDb }, "alice", "Alice");
      const auth = new SoftAuthenticator(TEST_ORIGIN);
      await registerPasskey({ json }, auth, issued);

      const client = new WakeClient({ baseUrl: base, getAssertion: auth.getAssertion });
      await client.login({ mode: "discoverable" });
      assertEquals(await (await client.wakeFetch("wake://station/me")).json(), { id: "alice", name: "Alice" });

      const echoed = await (await client.wakeFetch("wake://station/echo/hello?x=1", { method: "POST", body: "abc" }))
        .json() as { method: string; path: string; body: string; ebinaUser: string };
      assertEquals([echoed.method, echoed.path, echoed.body, echoed.ebinaUser], ["POST", "/hello?x=1", "abc", "alice"]);
      assertEquals(
        await (await client.wakeFetch("wake://station/notes/files/hello.txt")).text(),
        "こんにちは、メモです。\n",
      );
      const { pid } = await (await client.wakeFetch("wake://station/echo/__probe/pid")).json() as { pid: number };
      assert(isProcessAlive(pid));

      // CLI で消すと、動いている Station でも次のリクエストから 401
      assert(removeUser(cliDb, "alice"));
      assertEquals((await client.wakeFetch("wake://station/me")).status, 401);

      // 止めたら、アプリの子プロセスもいない
      await station.stop();
      stopped = true;
      assert(!isProcessAlive(pid), "Station を止めたのに、アプリの子プロセスが残っている");
    } finally {
      cliDb.close();
    }
  } finally {
    if (!stopped) await station.stop();
    await project.dispose();
  }
});

Deno.test("main: station.json が無いときは、例の場所を案内する ConfigError。DB は作らない", async () => {
  const project = await makeProject([]);
  try {
    const error = await assertRejects(() => startStation(project.paths, LOCAL), ConfigError);
    assertMatch(error.message, /station\.json/);
    assertMatch(error.message, /examples\/station\.json/);
    await assertRejects(() => Deno.stat(project.paths.db), Deno.errors.NotFound);
  } finally {
    await project.dispose();
  }
});

Deno.test("main: station.json が正しくないときも ConfigError（どの欄かが分かる）", async () => {
  const project = await makeProject([]);
  try {
    await Deno.writeTextFile(project.paths.config, JSON.stringify(testConfigJson({ rpId: "example.com" })));
    const error = await assertRejects(() => startStation(project.paths, LOCAL), ConfigError);
    assertEquals(error.field, "rpId");
  } finally {
    await project.dispose();
  }
});

Deno.test("main: ポートが使われていて待ち受けられないときは、起動した子プロセスと DB を片付けて投げる", async () => {
  const project = await makeStationProject(["echo"]);
  const occupied = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    const { port } = occupied.addr as Deno.NetAddr;
    await assertRejects(() => startStation(project.paths, { ...LOCAL, port }), PortInUseError);
  } finally {
    occupied.close();
    await project.dispose();
  }
});

async function readPidWhenWritten(pidFile: string): Promise<number> {
  let text = "";
  await waitFor(() => {
    try {
      text = Deno.readTextFileSync(pidFile);
      return text !== "";
    } catch {
      return false;
    }
  }, "アプリの子プロセスが pid を書く");
  return Number(text);
}

Deno.test("main: アプリの起動待ちの途中で abort すると、30 秒を待たずに片付けて StartAborted を投げる", async () => {
  const project = await makeStationProject(["echo"]);
  try {
    const pidFile = await writeSilentApp(project);
    const controller = new AbortController();
    const started = startStation(project.paths, { ...LOCAL, signal: controller.signal });
    const settled = started.then(() => undefined, (e) => e);
    const pid = await readPidWhenWritten(pidFile);
    assert(isProcessAlive(pid));

    const abortedAt = Date.now();
    controller.abort();
    const error = await settled;
    assert(error instanceof StartAborted, String(error));
    assert(Date.now() - abortedAt < 10_000, "abort してもすぐに返っていない");
    assert(!isProcessAlive(pid), "起動を中止したのに、アプリの子プロセスが残っている");
  } finally {
    await project.dispose();
  }
});

Deno.test("main: 始める前に abort 済みなら、アプリを起動せずに StartAborted を投げる", async () => {
  const project = await makeStationProject(["echo"]);
  try {
    await assertRejects(
      () => startStation(project.paths, { ...LOCAL, signal: AbortSignal.abort() }),
      StartAborted,
    );
  } finally {
    await project.dispose();
  }
});
