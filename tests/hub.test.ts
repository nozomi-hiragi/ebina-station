import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { parseBinette } from "@binette/core";
import type { EtHandlerRequest, EtHandlerResponse } from "@wake-protocol/server";
import { fromFileUrl, join } from "@std/path";
import { createAppHub, type EmbeddedAppHub } from "../src/apps/hub.ts";
import { setLogSink } from "../src/log.ts";
import { type ProjectPaths, projectPaths } from "../src/paths.ts";
import { FIXTURE_APPS_DIR, isProcessAlive, makeProject, waitFor, writeApp } from "./fixtures/mod.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function etRequest(method: string, headers: [string, string][] = [], body = ""): EtHandlerRequest {
  return { method, url: "wake://station/app", headers, body: encoder.encode(body) };
}

function bodyText(response: EtHandlerResponse): string {
  return decoder.decode(response.body ?? new Uint8Array(0));
}

function bodyJson(response: EtHandlerResponse): Record<string, unknown> {
  return JSON.parse(bodyText(response));
}

function headerNames(response: EtHandlerResponse): string[] {
  return (response.headers ?? []).map(([name]) => name);
}

const FAST = { restartBaseMs: 20, stopTimeoutMs: 2_000 };

async function withHub(
  fixtures: Parameters<typeof makeProject>[0],
  fn: (hub: EmbeddedAppHub, paths: ProjectPaths) => Promise<void>,
  states: { isEnabled(name: string): boolean } = { isEnabled: () => true },
): Promise<void> {
  const project = await makeProject(fixtures);
  setLogSink(() => {});
  const hub = createAppHub({ paths: project.paths, states, supervisor: FAST });
  try {
    await fn(hub, project.paths);
  } finally {
    await hub.stop();
    setLogSink(undefined);
    await project.dispose();
  }
}

/** echo の /__probe/pid から子プロセスの pid を取る */
async function pidOf(hub: EmbeddedAppHub, name: string): Promise<number> {
  const response = await hub.relay(name, "/__probe/pid", etRequest("GET"), "alice");
  assertEquals(response.status, 200);
  return bodyJson(response).pid as number;
}

const DENIED = ["NotCapable", "PermissionDenied"];

Deno.test("hub: fixtures を走査して一覧にし、echo へ中継する", async (t) => {
  await withHub(["echo", "notes", "broken"], async (hub, paths) => {
    await hub.start();

    await t.step("一覧（名前順）", () => {
      assertEquals(hub.list().map((app) => `${app.name}:${app.status}`), [
        "broken:error",
        "echo:running",
        "notes:running",
      ]);
      assertEquals(hub.get("echo"), {
        name: "echo",
        label: "Echo",
        icon: "🔁",
        version: "0.0.1",
        description: "受けたリクエストを返すテスト用のアプリ",
        enabled: true,
        status: "running",
        kind: "embedded",
      });
      const broken = hub.get("broken");
      assertEquals(broken?.label, "broken");
      assertStringIncludes(broken?.error ?? "", "label");
      assertEquals(hub.get("notes")?.error, undefined);
      assertEquals(hub.get("nothing"), undefined);
    });

    await t.step("メソッド・パス・クエリ・本文・ユーザー・トークン", async () => {
      const response = await hub.relay(
        "echo",
        "/hello?x=1",
        etRequest("POST", [
          ["Ebina-User", "evil"],
          ["eBiNa-App-Token", "forged"],
          ["Ebina-Other", "1"],
          ["X-Test", "1"],
          ["Content-Type", "text/plain"],
        ], "abc"),
        "alice",
      );
      assertEquals(response.status, 200);
      assertEquals(headerNames(response).includes("content-type"), true);
      const seen = bodyJson(response);
      assertEquals(seen.method, "POST");
      assertEquals(seen.path, "/hello?x=1");
      assertEquals(seen.body, "abc");
      assertEquals(seen.ebinaUser, "alice");
      assertEquals(seen.hasAppToken, true);
      const headers = seen.headers as Record<string, string>;
      assertEquals(headers["x-test"], "1");
      assertEquals(headers["content-type"], "text/plain");
      assertEquals(headers["ebina-user"], "alice");
      assertFalse("ebina-other" in headers);
      assertFalse("ebina-app-token" in headers); // echo は値を返さない
      assertEquals((seen.headerNames as string[]).filter((name) => name.startsWith("ebina-")), [
        "ebina-app-token",
        "ebina-user",
      ]);
      // 偽のトークンは本物に置き換わっていて、echo は応答に値を出さない
      assertFalse(bodyText(response).includes("forged"));

      const get = await hub.relay("echo", "/", etRequest("GET", [], "本文は付かない"), "bob");
      const seenGet = bodyJson(get);
      assertEquals(seenGet.method, "GET");
      assertEquals(seenGet.path, "/");
      assertEquals(seenGet.body, "");
      assertEquals(seenGet.ebinaUser, "bob");
    });

    await t.step("アプリの権限は絞られている", async () => {
      const write = await hub.relay("echo", "/__probe/write", etRequest("GET"), "alice");
      assertEquals(bodyJson(write), { ok: true, content: "データフォルダに書けた" });
      assertEquals(await Deno.readTextFile(join(paths.appDataDir("echo"), "probe.txt")), "データフォルダに書けた");

      const read = async (path: string) => {
        const response = await hub.relay(
          "echo",
          `/__probe/read?path=${encodeURIComponent(path)}`,
          etRequest("GET"),
          "a",
        );
        return bodyJson(response);
      };
      // 自分のフォルダは読める。ほかのアプリ・project の外・Station のファイルは読めない
      assertEquals((await read(join(paths.appsDir, "echo", "app.json"))).ok, true);
      for (const path of [join(paths.appsDir, "notes", "app.json"), "/etc/passwd", paths.appsDir, paths.root]) {
        const result = await read(path);
        assertEquals(result.ok, false, path);
        assert(DENIED.includes(result.error as string), `${path}: ${result.error}`);
      }

      const outside = bodyJson(await hub.relay("echo", "/__probe/write-outside", etRequest("GET"), "a"));
      assertEquals(outside.ok, false);
      assert(DENIED.includes(outside.error as string), String(outside.error));
      await Deno.stat(join(paths.appsDir, "echo", "evil.txt")).then(
        () => assert(false, "アプリのフォルダへ書けてしまった"),
        (error) => assert(error instanceof Deno.errors.NotFound),
      );

      const net = bodyJson(await hub.relay("echo", "/__probe/net", etRequest("GET"), "a"));
      for (const key of ["external", "loopback", "connect"]) {
        const result = net[key] as { ok: boolean; error?: string };
        assertEquals(result.ok, false, key);
        assert(DENIED.includes(result.error as string), `${key}: ${result.error}`);
      }

      const env = bodyJson(await hub.relay("echo", "/__probe/env", etRequest("GET"), "a"));
      assertEquals(env.dataDir, { ok: true, value: true });
      for (const key of ["home", "path"]) {
        const result = env[key] as { ok: boolean; error?: string };
        assertEquals(result.ok, false, key);
        assert(DENIED.includes(result.error as string), `${key}: ${result.error}`);
      }

      const run = bodyJson(await hub.relay("echo", "/__probe/run", etRequest("GET"), "a"));
      assertEquals(run.ok, false);
      assert(DENIED.includes(run.error as string), String(run.error));
    });

    await t.step("応答のヘッダーと本文の上限", async () => {
      const headers = await hub.relay("echo", "/__probe/response-headers", etRequest("GET"), "a");
      assertEquals(headers.status, 200);
      assertEquals(bodyText(headers), "headers");
      assertEquals(headers.headers?.find(([name]) => name === "x-visible")?.[1], "yes");
      for (const dropped of ["set-cookie", "ebina-secret", "content-length"]) {
        assertFalse(headerNames(headers).includes(dropped), dropped);
      }

      const exact = await hub.relay("echo", `/__probe/big?size=${1024 * 1024}`, etRequest("GET"), "a");
      assertEquals(exact.status, 200);
      assertEquals(exact.body?.byteLength, 1024 * 1024);
      const over = await hub.relay("echo", `/__probe/big?size=${1024 * 1024 + 1}`, etRequest("GET"), "a");
      assertEquals(over.status, 502);
      assertEquals(bodyJson(over), { error: { code: "bad_gateway" } });
      // 上限を超えた応答のあとも使える
      assertEquals((await hub.relay("echo", "/", etRequest("GET"), "a")).status, 200);
    });

    await t.step("notes は子プロセス無しで panoplie/ を配る", async () => {
      assertEquals(hub.logs("notes"), []);
      const index = await hub.relay("notes", "/index.bina", etRequest("GET"), "alice");
      assertEquals(index.status, 200);
      assertEquals(parseBinette(bodyText(index)).title, "メモ");
      const file = await hub.relay("notes", "/files/hello.txt", etRequest("GET"), "alice");
      assertEquals(file.status, 200);
      assertEquals(bodyText(file), "こんにちは、メモです。\n");
      assertEquals((await hub.relay("notes", "/nope.bina", etRequest("GET"), "alice")).status, 404);
      assertEquals((await hub.relay("notes", "/index.bina", etRequest("POST"), "alice")).status, 405);
    });

    await t.step("broken は 503、無い名前・予約名・不正な名前やパスは 404 / 400", async () => {
      const broken = await hub.relay("broken", "/", etRequest("GET"), "alice");
      assertEquals(broken.status, 503);
      assertEquals(bodyJson(broken), { error: { code: "app_unavailable" } });

      for (const name of ["nothing", "settings", "index", "me", "station", "ebina", "Echo", "../echo", "echo/x", ""]) {
        const response = await hub.relay(name, "/", etRequest("GET"), "alice");
        assertEquals(response.status, 404, name);
        assertEquals(bodyJson(response), { error: { code: "not_found" } }, name);
      }
      for (const path of ["", "x", "@evil.example/", "/a b", "/a#b", "/日本語"]) {
        const response = await hub.relay("echo", path, etRequest("GET"), "alice");
        assertEquals(response.status, 400, JSON.stringify(path));
        assertEquals(bodyJson(response), { error: { code: "invalid_url" } });
      }
    });

    await t.step("子が落ちると 503 になり、再起動で戻る", async () => {
      const before = await pidOf(hub, "echo");
      const crash = await hub.relay("echo", "/__probe/crash", etRequest("GET"), "alice");
      assertEquals(bodyJson(crash), { crashing: true });
      await waitFor(() => hub.get("echo")?.status !== "running", "落ちたのが見える");
      assertEquals((await hub.relay("echo", "/", etRequest("GET"), "alice")).status, 503);
      await waitFor(() => hub.get("echo")?.status === "running", "再起動して戻る");
      const after = await pidOf(hub, "echo");
      assert(after !== before);
      assertFalse(isProcessAlive(before));
    });

    await t.step("ログを読める", () => {
      const lines = hub.logs("echo").map((line) => line.text);
      assert(lines.includes("EBINA_READY"));
      assertEquals(hub.logs("broken"), []);
      assertEquals(hub.logs("nothing"), []);
    });

    await t.step("stop() で子プロセスが残らない", async () => {
      const pid = await pidOf(hub, "echo");
      await hub.stop();
      assertFalse(isProcessAlive(pid));
      assertEquals(hub.get("echo")?.status, "stopped");
      assertEquals((await hub.relay("echo", "/", etRequest("GET"), "alice")).status, 503);
    });
  });
});

Deno.test("hub: entry と panoplie/ の両方があるアプリは、子が 404 のときだけ panoplie/ から探す", async () => {
  await withHub([], async (hub, paths) => {
    await writeApp(paths, "combo", {
      "app.json": JSON.stringify({ label: "両方", entry: "main.ts" }),
      "main.ts": `export default {
        fetch(req: Request) {
          const { pathname } = new URL(req.url);
          if (pathname === "/dynamic") return new Response("動的");
          if (pathname === "/index.bina") return new Response("子の index", { status: 200 });
          return new Response("子の 404", { status: 404 });
        },
      };`,
      "panoplie/files/static.txt": "静的",
      "panoplie/index.bina": JSON.stringify({ binette: "0.1", redirect: "/home" }),
    });
    await hub.start();
    assertEquals(hub.get("combo")?.status, "running");

    assertEquals(bodyText(await hub.relay("combo", "/dynamic", etRequest("GET"), "a")), "動的");
    // 子が答えるものは子が優先
    assertEquals(bodyText(await hub.relay("combo", "/index.bina", etRequest("GET"), "a")), "子の index");
    // 子が 404 なら panoplie/ から
    const fallback = await hub.relay("combo", "/files/static.txt", etRequest("GET"), "a");
    assertEquals(fallback.status, 200);
    assertEquals(bodyText(fallback), "静的");
    assertEquals((await hub.relay("combo", "/files/static.txt", etRequest("HEAD"), "a")).status, 200);
    // どちらにも無ければ子の 404
    const none = await hub.relay("combo", "/nothing", etRequest("GET"), "a");
    assertEquals(none.status, 404);
    assertEquals(bodyText(none), "子の 404");
    // GET と HEAD 以外は panoplie/ に探しに行かない
    assertEquals(bodyText(await hub.relay("combo", "/files/static.txt", etRequest("POST"), "a")), "子の 404");
  });
});

Deno.test("hub: 無効にしたアプリは起動せず 404、有効に戻して reload() で起動する", async () => {
  const disabled = new Set<string>(["echo", "notes"]);
  const states = { isEnabled: (name: string) => !disabled.has(name) };
  await withHub(["echo", "notes"], async (hub) => {
    await hub.start();
    for (const name of ["echo", "notes"]) {
      const info = hub.get(name);
      assertEquals(info?.enabled, false, name);
      assertEquals(info?.status, "stopped", name);
      assertEquals((await hub.relay(name, "/", etRequest("GET"), "alice")).status, 404, name);
    }
    assertEquals(hub.logs("echo"), []);

    disabled.delete("echo");
    await hub.reload();
    assertEquals(hub.get("echo")?.status, "running");
    assertEquals(hub.get("echo")?.enabled, true);
    assertEquals(hub.get("notes")?.status, "stopped");
    const pid = await pidOf(hub, "echo");

    // 無効にして reload() すると止まる
    disabled.add("echo");
    await hub.reload();
    assertEquals(hub.get("echo")?.status, "stopped");
    assertFalse(isProcessAlive(pid));
    assertEquals((await hub.relay("echo", "/", etRequest("GET"), "alice")).status, 404);
  }, states);
});

Deno.test("hub: reload() は増えたものを起動し、消えたものを止め、変わっていないものは動かし続ける", async () => {
  await withHub(
    [{ from: "echo", as: "keep" }, { from: "echo", as: "drop" }, { from: "echo", as: "edit" }],
    async (hub, paths) => {
      await hub.start();
      assertEquals(hub.list().map((app) => app.name), ["drop", "edit", "keep"]);
      const keepPid = await pidOf(hub, "keep");
      const dropPid = await pidOf(hub, "drop");
      const editPid = await pidOf(hub, "edit");

      // 追加（静的と、子プロセスのもの）・削除・app.json の書き換え
      await writeApp(paths, "added", {
        "app.json": JSON.stringify({ label: "追加" }),
        "panoplie/index.bina": JSON.stringify({ binette: "0.1", redirect: "/home" }),
      });
      // ビネットとして正しくない panoplie/ は、そのアプリだけ error
      await writeApp(paths, "badsite", {
        "app.json": JSON.stringify({ label: "壊れた" }),
        "panoplie/index.bina": "{}",
      });
      await writeApp(paths, "late", {
        "app.json": JSON.stringify({ label: "遅れて", entry: "main.ts" }),
        "main.ts": await Deno.readTextFile(join(FIXTURE_APPS_DIR, "echo", "main.ts")),
      });
      await Deno.remove(join(paths.appsDir, "drop"), { recursive: true });
      await Deno.writeTextFile(
        join(paths.appsDir, "edit", "app.json"),
        JSON.stringify({ label: "書き換えた", entry: "main.ts" }),
      );
      await hub.reload();

      assertEquals(hub.list().map((app) => app.name), ["added", "badsite", "edit", "keep", "late"]);
      assertEquals(hub.get("added")?.status, "running");
      assertEquals(hub.get("badsite")?.status, "error");
      assertStringIncludes(hub.get("badsite")?.error ?? "", "panoplie/ を読み込めません");
      assertEquals((await hub.relay("badsite", "/index.bina", etRequest("GET"), "alice")).status, 503);
      assertEquals(hub.get("late")?.status, "running");
      assertEquals((await pidOf(hub, "late")) > 0, true);

      assertEquals(hub.get("drop"), undefined);
      assertEquals((await hub.relay("drop", "/", etRequest("GET"), "alice")).status, 404);
      assertFalse(isProcessAlive(dropPid), "消えたアプリの子プロセスが残っている");

      assertEquals(await pidOf(hub, "keep"), keepPid, "変わっていないアプリが再起動された");
      assertEquals(hub.get("keep")?.label, "Echo");

      assertEquals(hub.get("edit")?.label, "書き換えた");
      assert((await pidOf(hub, "edit")) !== editPid, "書き換えたアプリが再起動されていない");
      assertFalse(isProcessAlive(editPid));

      // 壊すと error に、直して reload() すると戻る
      await Deno.writeTextFile(join(paths.appsDir, "keep", "app.json"), "{ 壊れた");
      await hub.reload();
      assertEquals(hub.get("keep")?.status, "error");
      assertStringIncludes(hub.get("keep")?.error ?? "", "JSON として読めません");
      assertFalse(isProcessAlive(keepPid));
      await Deno.writeTextFile(
        join(paths.appsDir, "keep", "app.json"),
        JSON.stringify({ label: "直した", entry: "main.ts" }),
      );
      await hub.reload();
      assertEquals(hub.get("keep")?.status, "running");
      assertEquals(hub.get("keep")?.label, "直した");
    },
  );
});

Deno.test("hub: 起動に失敗するアプリは error になり、ほかのアプリに影響しない", async () => {
  const project = await makeProject(["notes"]);
  setLogSink(() => {});
  const hub = createAppHub({
    paths: project.paths,
    states: { isEnabled: () => true },
    supervisor: { restartBaseMs: 10, crashLimit: 2 },
  });
  try {
    await writeApp(project.paths, "boom", {
      "app.json": JSON.stringify({ label: "落ちる", entry: "main.ts" }),
      "main.ts": `throw new Error("boom-message");`,
    });
    await hub.start();
    await waitFor(() => hub.get("boom")?.status === "error", "boom が error になる");
    assertStringIncludes(hub.get("boom")?.error ?? "", "2 回終了したため止めました");
    assertEquals((await hub.relay("boom", "/", etRequest("GET"), "alice")).status, 503);
    assert(hub.logs("boom").some((line) => line.text.includes("boom-message")));
    assertEquals(hub.get("notes")?.status, "running");
    assertEquals((await hub.relay("notes", "/index.bina", etRequest("GET"), "alice")).status, 200);

    // error になった子プロセスは reload() で作り直される
    await Deno.writeTextFile(
      join(project.paths.appsDir, "boom", "main.ts"),
      `export default { fetch: () => new Response("直った") };`,
    );
    await hub.reload();
    assertEquals(hub.get("boom")?.status, "running");
    assertEquals(bodyText(await hub.relay("boom", "/", etRequest("GET"), "alice")), "直った");
  } finally {
    await hub.stop();
    setLogSink(undefined);
    await project.dispose();
  }
});

Deno.test("hub: apps/ が無くても start() と stop() は通る", async () => {
  const root = await Deno.makeTempDir({ prefix: "ebina-hub-" });
  setLogSink(() => {});
  try {
    const hub = createAppHub({ paths: projectPaths(root), states: { isEnabled: () => true } });
    await hub.start();
    assertEquals(hub.list(), []);
    await hub.reload();
    await hub.stop();
    await hub.stop();
  } finally {
    setLogSink(undefined);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("hub: HTTP_PROXY があっても、子プロセスへは直接つなぐ（トークンをプロキシへ送らない）", async () => {
  const project = await makeProject(["echo"]);
  try {
    const script = fromFileUrl(new URL("./fixtures/relay_via_hub.ts", import.meta.url));
    const config = fromFileUrl(new URL("../deno.json", import.meta.url));
    // つながらないプロキシを指定する。中継がプロキシを通ると失敗する（NO_PROXY は付けない）
    const env: Record<string, string> = { HTTP_PROXY: "http://127.0.0.1:1", http_proxy: "http://127.0.0.1:1" };
    for (const key of ["PATH", "HOME", "DENO_DIR", "XDG_CACHE_HOME"]) {
      const value = Deno.env.get(key);
      if (value !== undefined) env[key] = value;
    }
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-prompt",
        `--config=${config}`,
        "--allow-net",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run",
        script,
        project.paths.root,
      ],
      clearEnv: true,
      env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = decoder.decode(output.stderr);
    assert(output.success, stderr);
    const result = JSON.parse(decoder.decode(output.stdout).trim().split("\n").at(-1) ?? "");
    assertEquals(result.status, 200, stderr);
    assertEquals(JSON.parse(result.body).path, "/hello?x=1");
  } finally {
    await project.dispose();
  }
});

Deno.test("hub: アプリのフォルダにシンボリックリンクがあれば error で、起動せず、リンク先は読めない", async () => {
  await withHub(["echo"], async (hub, paths) => {
    // 権限の外にあるファイル（Station の DB に見立てる）
    const stationDir = join(paths.root, "data", "station");
    await Deno.mkdir(stationDir, { recursive: true });
    await Deno.writeTextFile(join(stationDir, "station.db"), "SQLite format 3 SECRET-CONTENT");
    const appDir = join(paths.appsDir, "echo");
    await Deno.symlink(stationDir, join(appDir, "escape"));
    await Deno.symlink("/etc", join(appDir, "etc"));

    await hub.start();
    const info = hub.get("echo");
    assertEquals(info?.status, "error");
    assertStringIncludes(info?.error ?? "", "シンボリックリンクがあります");

    // 子プロセスは起動せず、リンクを通した読み出しもできない
    const read = async (path: string) =>
      await hub.relay("echo", `/__probe/read?path=${encodeURIComponent(path)}`, etRequest("GET"), "alice");
    for (const path of [join(appDir, "escape", "station.db"), join(appDir, "etc", "hostname")]) {
      const response = await read(path);
      assertEquals(response.status, 503, path);
      assertFalse(bodyText(response).includes("SECRET-CONTENT"));
    }

    // リンクを消して reload() すれば動く。直接のパスは、これまでどおり権限の外
    await Deno.remove(join(appDir, "escape"));
    await Deno.remove(join(appDir, "etc"));
    await hub.reload();
    assertEquals(hub.get("echo")?.status, "running");
    const direct = await read(join(stationDir, "station.db"));
    assertEquals(direct.status, 200);
    assert(DENIED.includes(bodyJson(direct).error as string), bodyText(direct));
  });
});

Deno.test("hub: panoplie/ に配れない大きさのファイルがあれば、読み込まずにそのアプリを error にする", async () => {
  await withHub(["notes"], async (hub, paths) => {
    await writeApp(paths, "big", {
      "app.json": JSON.stringify({ label: "大きい" }),
      "panoplie/index.bina": JSON.stringify({ binette: "0.1", redirect: "/home" }),
    });
    const file = join(paths.appsDir, "big", "panoplie", "files", "video.bin");
    await Deno.mkdir(join(file, ".."), { recursive: true });
    await Deno.writeFile(file, new Uint8Array(1024 * 1024 + 1));

    await hub.start();
    assertEquals(hub.get("big")?.status, "error");
    assertStringIncludes(hub.get("big")?.error ?? "", "panoplie/ を読み込めません");
    assertStringIncludes(hub.get("big")?.error ?? "", "files/video.bin が大きすぎます");
    assertEquals((await hub.relay("big", "/index.bina", etRequest("GET"), "alice")).status, 503);
    // ほかのアプリには影響しない
    assertEquals(hub.get("notes")?.status, "running");

    // 上限ちょうどなら配れる
    await Deno.writeFile(file, new Uint8Array(1024 * 1024));
    await hub.reload();
    assertEquals(hub.get("big")?.status, "running");
  });
});
