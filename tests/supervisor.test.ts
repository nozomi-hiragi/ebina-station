import { assert, assertEquals, assertFalse, assertNotEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { setLogSink } from "../src/log.ts";
import { AppSupervisor, probeProof, type SupervisorOptions } from "../src/apps/supervisor.ts";
import type { ProjectPaths } from "../src/paths.ts";
import { isProcessAlive, makeProject, waitFor, writeApp } from "./fixtures/mod.ts";

const APP_JSON = JSON.stringify({ label: "テスト", entry: "main.ts" });

/** apps/<name>/ に main.ts を書き、それを動かす AppSupervisor を作る */
async function supervisorFor(
  paths: ProjectPaths,
  name: string,
  source: string,
  options: Partial<SupervisorOptions> = {},
): Promise<AppSupervisor> {
  const appDir = await writeApp(paths, name, { "app.json": APP_JSON, "main.ts": source });
  return new AppSupervisor({
    name,
    appDir,
    dataDir: paths.appDataDir(name),
    entry: join(appDir, "main.ts"),
    ...options,
  });
}

async function withProject(fn: (paths: ProjectPaths) => Promise<void>): Promise<void> {
  const project = await makeProject();
  // 起動・終了の記録でテストの出力を汚さない
  setLogSink(() => {});
  try {
    await fn(project.paths);
  } finally {
    setLogSink(undefined);
    await project.dispose();
  }
}

function authorized(supervisor: AppSupervisor, path: string): Promise<Response> {
  const target = supervisor.target();
  assert(target !== undefined, "running ではありません");
  return fetch(`http://127.0.0.1:${target.port}${path}`, { headers: { "Ebina-App-Token": target.token } });
}

const OK_APP = `export default { fetch: () => new Response("ok") };`;

Deno.test("supervisor: 起動して running になり、トークンの無いリクエストは 403", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(paths, "app", OK_APP);
    try {
      assertEquals(supervisor.status, "stopped");
      assertEquals(supervisor.target(), undefined);

      await supervisor.start();
      assertEquals(supervisor.status, "running");
      // データフォルダは起動前に作られる
      assertEquals((await Deno.stat(paths.appDataDir("app"))).isDirectory, true);

      const target = supervisor.target();
      assert(target !== undefined);
      const base = `http://127.0.0.1:${target.port}`;
      for (
        const headers of [
          {} as Record<string, string>,
          { "Ebina-App-Token": "wrong" },
          { "Ebina-App-Token": "x".repeat(target.token.length) },
        ]
      ) {
        const response = await fetch(`${base}/x`, { headers });
        assertEquals(response.status, 403, JSON.stringify(headers));
        assertEquals(await response.json(), { error: { code: "forbidden" } });
      }
      const ok = await authorized(supervisor, "/x");
      assertEquals(ok.status, 200);
      assertEquals(await ok.text(), "ok");

      // ログに READY と起動の記録が残る
      const logs = supervisor.logs();
      assert(logs.some((line) => line.stream === "stdout" && line.text === "EBINA_READY"));
      assert(logs.some((line) => line.stream === "station" && line.text.startsWith("起動しました")));

      const pid = supervisor.pid;
      assert(pid !== undefined && isProcessAlive(pid));
      await supervisor.stop();
      assertEquals(supervisor.status, "stopped");
      assertEquals(supervisor.target(), undefined);
      assertEquals(supervisor.pid, undefined);
      assertFalse(isProcessAlive(pid), "stop() のあとに子プロセスが残っている");
      // 止めたあとは待ち受けていない
      await fetch(`${base}/x`).then((r) => r.body?.cancel(), () => {});
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: 動いているときの start() は何もせず、stop() は何度呼んでもよい", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(paths, "app", OK_APP);
    try {
      await supervisor.stop(); // 起動前
      await supervisor.start();
      const pid = supervisor.pid;
      await supervisor.start();
      assertEquals(supervisor.pid, pid);
      await Promise.all([supervisor.stop(), supervisor.stop()]);
      assertEquals(supervisor.status, "stopped");
      // 止めたあとにもう一度起動できる
      await supervisor.start();
      assertEquals(supervisor.status, "running");
      assertNotEquals(supervisor.pid, pid);
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: 落ちたら再起動する（新しいトークンで）", async () => {
  await withProject(async (paths) => {
    const echo = await Deno.readTextFile(new URL("./fixtures/apps/echo/main.ts", import.meta.url));
    const supervisor = await supervisorFor(paths, "app", echo, { restartBaseMs: 20 });
    try {
      await supervisor.start();
      const firstPid = supervisor.pid;
      const firstToken = supervisor.target()?.token;
      assert(firstPid !== undefined && firstToken !== undefined);

      const crash = await authorized(supervisor, "/__probe/crash");
      assertEquals(await crash.json(), { crashing: true });

      await waitFor(
        () => supervisor.status === "running" && supervisor.pid !== undefined && supervisor.pid !== firstPid,
        "再起動して running に戻る",
      );
      assertNotEquals(supervisor.target()?.token, firstToken);
      assertFalse(isProcessAlive(firstPid));
      const response = await authorized(supervisor, "/__probe/pid");
      assertEquals(await response.json(), { pid: supervisor.pid });

      const notes = supervisor.logs().filter((line) => line.stream === "station").map((line) => line.text);
      assert(notes.some((text) => text.includes("終了しました（終了コード 3）")), notes.join("\n"));
      assert(notes.some((text) => text.includes("20 ミリ秒後に再起動します")), notes.join("\n"));
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: 続けて落ちると間隔を延ばして再起動し、上限で error にして止める", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(paths, "boom", `throw new Error("boom-message");`, {
      restartBaseMs: 50,
      restartMaxMs: 10_000,
      crashLimit: 3,
    });
    try {
      await supervisor.start(); // 最初の起動が終わる（落ちる）まで
      assert(supervisor.status !== "running");
      await waitFor(() => supervisor.status === "error", "error になる");
      assertStringIncludes(supervisor.error ?? "", "3 回終了したため止めました");
      assertStringIncludes(supervisor.error ?? "", "終了コード 1");
      assertEquals(supervisor.target(), undefined);
      assertEquals(supervisor.pid, undefined);

      const logs = supervisor.logs();
      assertEquals(logs.filter((line) => line.text.startsWith("起動しました")).length, 3);
      // 間隔は 50、100 と倍になる（3 回目で止まるので、その先は無い）
      const notes = logs.filter((line) => line.stream === "station").map((line) => line.text);
      assert(notes.some((text) => text.includes("50 ミリ秒後に再起動します")), notes.join("\n"));
      assert(notes.some((text) => text.includes("100 ミリ秒後に再起動します")), notes.join("\n"));
      assertFalse(notes.some((text) => text.includes("200 ミリ秒後に再起動します")), notes.join("\n"));
      // 理由は標準エラーに残る
      assert(logs.some((line) => line.stream === "stderr" && line.text.includes("boom-message")));

      await supervisor.stop();
      assertEquals(supervisor.status, "stopped");
      assertEquals(supervisor.error, undefined);
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: EBINA_READY が来なければ止めて error にする（再起動しない）", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(
      paths,
      "slow",
      `await new Promise((resolve) => setTimeout(resolve, 60_000));`,
      {
        startTimeoutMs: 400,
        restartBaseMs: 10,
      },
    );
    try {
      const started = supervisor.start();
      await waitFor(() => supervisor.pid !== undefined, "子プロセスが起動する");
      const pid = supervisor.pid!;
      await started;
      assertEquals(supervisor.status, "error");
      assertStringIncludes(supervisor.error ?? "", "準備ができなかった");
      assertFalse(isProcessAlive(pid), "時間切れの子プロセスが残っている");

      // 再起動しない
      await new Promise((resolve) => setTimeout(resolve, 200));
      assertEquals(supervisor.logs().filter((line) => line.text.startsWith("起動しました")).length, 1);
      assertEquals(supervisor.status, "error");
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: アプリが EBINA_READY を出力しても、待ち受けを確かめられなければ running にしない", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(
      paths,
      "spoof",
      `console.log("EBINA_READY");\nawait new Promise((resolve) => setTimeout(resolve, 60_000));`,
      { startTimeoutMs: 1_500, restartBaseMs: 10 },
    );
    try {
      await supervisor.start();
      assertEquals(supervisor.status, "error");
      assertStringIncludes(supervisor.error ?? "", "準備ができなかった");
      assertEquals(supervisor.target(), undefined);
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: 確認のヘッダーは runner が答え（nonce への HMAC）、アプリには届かない", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(
      paths,
      "probe",
      `export default { fetch: (req) => new Response(req.headers.has("ebina-runner-probe") ? "leaked" : "ok") };`,
    );
    try {
      await supervisor.start();
      assertEquals(supervisor.status, "running");
      const target = supervisor.target()!;
      // 確認はトークン無しで通り、応答の HMAC はトークンを知る側だけが確かめられる
      const res = await fetch(`http://127.0.0.1:${target.port}/`, { headers: { "Ebina-Runner-Probe": "abc" } });
      assertEquals(res.status, 204);
      assertEquals(res.headers.get("ebina-runner-proof"), await probeProof(target.token, "abc"));
      await res.body?.cancel();
      const normal = await authorized(supervisor, "/");
      assertEquals(await normal.text(), "ok");
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: 先にポートを取った偽物は running にならず、トークンも受け取れない", async () => {
  await withProject(async (paths) => {
    // 偽の runner: 起動の合図の行を出し、どんな確認にも「準備できた」と答える。届いたヘッダーを記録する
    const fakeRunner = join(paths.root, "fake-runner.ts");
    await Deno.writeTextFile(
      fakeRunner,
      `const port = Number(Deno.env.get("EBINA_PORT"));
const dir = Deno.env.get("EBINA_DATA_DIR");
Deno.serve({ hostname: "127.0.0.1", port, onListen: () => console.log("EBINA_READY") }, (req) => {
  Deno.writeTextFileSync(dir + "/seen.log", JSON.stringify([...req.headers]) + "\\n", { append: true });
  return new Response(null, { status: 204, headers: { "ebina-runner-probe": "ready", "ebina-runner-proof": "00".repeat(32) } });
});`,
    );
    const supervisor = await supervisorFor(paths, "fake", OK_APP, {
      runnerPath: fakeRunner,
      startTimeoutMs: 1_500,
      restartBaseMs: 10,
    });
    try {
      await supervisor.start();
      assertEquals(supervisor.status, "error", supervisor.logs().map((line) => line.text).join("\n"));
      assertEquals(supervisor.target(), undefined);
      const seen = await Deno.readTextFile(join(paths.appDataDir("fake"), "seen.log"));
      assert(seen.includes("ebina-runner-probe"), "確認が届いていない");
      assertFalse(seen.includes("ebina-app-token"), "偽物にトークンが渡った");
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("runner: entry の読み込みが済むまでは待ち受けて 503 を返し、済むと HMAC で答える", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ebina-runner-test-" });
  const probe = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (probe.addr as Deno.NetAddr).port;
  probe.close();
  const entry = join(dir, "slow.ts");
  await Deno.writeTextFile(
    entry,
    `await new Promise((resolve) => setTimeout(resolve, 1500));\nexport default { fetch: () => new Response("ok") };`,
  );
  const runner = fromFileUrl(new URL("../runner/runner.ts", import.meta.url));
  const token = "secret-token";
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-prompt", "-A", runner, `file://${entry}`],
    clearEnv: true,
    env: { EBINA_PORT: String(port), EBINA_APP_TOKEN: token, EBINA_DATA_DIR: dir },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  const get = async (headers: Record<string, string>) => {
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { headers });
        return res;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error("runner に接続できません");
  };
  try {
    // import の最中: 確認にも通常のリクエストにも 503
    const early = await get({ "ebina-runner-probe": "n1" });
    assertEquals(early.status, 503);
    assertEquals(early.headers.get("ebina-runner-proof"), null);
    await early.body?.cancel();
    const earlyNormal = await get({ "ebina-app-token": token });
    assertEquals(earlyNormal.status, 503);
    await earlyNormal.body?.cancel();
    // トークンの無いリクエストは 403
    const forbidden = await get({});
    assertEquals(forbidden.status, 403);
    await forbidden.body?.cancel();

    // 読み込みが済んだら 204 と HMAC、通常のリクエストはアプリへ
    let done: Response | undefined;
    for (let i = 0; i < 100 && done?.status !== 204; i++) {
      await done?.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 100));
      done = await get({ "ebina-runner-probe": "n2" });
    }
    assertEquals(done?.status, 204);
    assertEquals(done?.headers.get("ebina-runner-proof"), await probeProof(token, "n2"));
    await done?.body?.cancel();
    const normal = await get({ "ebina-app-token": token });
    assertEquals(await normal.text(), "ok");
  } finally {
    child.kill("SIGKILL");
    await child.status;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("supervisor: stop() は SIGTERM に応じない子を SIGKILL で止める", async () => {
  await withProject(async (paths) => {
    const source = `
      export default {
        fetch(req: Request) {
          if (new URL(req.url).pathname === "/hang") {
            console.log("hang-request");
            return new Promise<Response>(() => {});
          }
          return new Response("ok");
        },
      };`;
    const supervisor = await supervisorFor(paths, "hang", source, { stopTimeoutMs: 200 });
    const controller = new AbortController();
    try {
      await supervisor.start();
      const pid = supervisor.pid!;
      const target = supervisor.target()!;
      const pending = fetch(`http://127.0.0.1:${target.port}/hang`, {
        headers: { "Ebina-App-Token": target.token },
        signal: controller.signal,
      }).then((r) => r.body?.cancel(), () => {});
      await waitFor(() => supervisor.logs().some((line) => line.text === "hang-request"), "処理中のリクエストができる");

      const begin = performance.now();
      await supervisor.stop();
      const elapsed = performance.now() - begin;
      // runner は処理中のリクエストを 2 秒待つので、それより早く止まっていれば Station が SIGKILL した
      assert(elapsed < 1_500, `止めるのに ${elapsed} ミリ秒かかった`);
      assert(supervisor.logs().some((line) => line.text.includes("SIGKILL")), "SIGKILL の記録が無い");
      assertFalse(isProcessAlive(pid));
      controller.abort();
      await pending;
    } finally {
      controller.abort();
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: default export が関数でも動く", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(
      paths,
      "fn",
      `export default (req: Request) => new Response("fn:" + new URL(req.url).pathname);`,
    );
    try {
      await supervisor.start();
      assertEquals(await (await authorized(supervisor, "/x")).text(), "fn:/x");
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: fetch の無い entry は error（理由は標準エラーに残る）", async () => {
  await withProject(async (paths) => {
    const cases: [string, string][] = [
      ["no-default", `export const x = 1;`],
      ["number", `export default 1;`],
      ["no-fetch", `export default { notFetch() {} };`],
      ["syntax", `export default {`],
    ];
    for (const [name, source] of cases) {
      const supervisor = await supervisorFor(paths, name, source, { crashLimit: 1 });
      try {
        await supervisor.start();
        await waitFor(() => supervisor.status === "error", `${name} が error になる`);
        assertEquals(supervisor.pid, undefined, name);
        const errors = supervisor.logs().filter((line) => line.stream === "stderr").map((line) => line.text).join("\n");
        assertStringIncludes(errors, name === "syntax" ? "entry を読み込めません" : "fetch がありません", name);
      } finally {
        await supervisor.stop();
      }
    }
  });
});

Deno.test("supervisor: fetch が投げる・Response を返さないときは 500 で、理由は応答に出さない", async () => {
  await withProject(async (paths) => {
    const source = `
      export default {
        fetch(req: Request) {
          if (new URL(req.url).pathname === "/throw") throw new Error("secret-detail");
          return "文字列" as unknown as Response;
        },
      };`;
    const supervisor = await supervisorFor(paths, "bad", source);
    try {
      await supervisor.start();
      for (const path of ["/throw", "/string"]) {
        const response = await authorized(supervisor, path);
        assertEquals(response.status, 500, path);
        const body = await response.text();
        assertEquals(JSON.parse(body), { error: { code: "internal_error" } });
        assertFalse(body.includes("secret-detail"));
      }
      // 落ちずに動き続け、理由は標準エラーに残る
      assertEquals(supervisor.status, "running");
      assert(supervisor.logs().some((line) => line.stream === "stderr" && line.text.includes("secret-detail")));
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: ログは最新の行だけ持ち、長い行は区切る", async () => {
  await withProject(async (paths) => {
    const ring = await supervisorFor(
      paths,
      "ring",
      `for (let i = 0; i < 100; i++) console.log("line " + i);\n${OK_APP}`,
      { maxLogLines: 50 },
    );
    try {
      await ring.start();
      const logs = ring.logs();
      assertEquals(logs.length, 50);
      assertEquals(logs.at(-1)?.text, "EBINA_READY");
      assertEquals(logs.at(-2)?.text, "line 99");
      assertEquals(logs.at(-51 + 1)?.text, "line 51");
    } finally {
      await ring.stop();
    }

    const long = await supervisorFor(paths, "long", `console.error("x".repeat(20000));\n${OK_APP}`);
    try {
      await long.start();
      const chunks = long.logs().filter((line) => line.stream === "stderr").map((line) => line.text);
      assertEquals(chunks.map((text) => text.length), [8192, 8192, 3616]);
    } finally {
      await long.stop();
    }
  });
});

Deno.test("supervisor: パスに , があると権限を正しく指定できないので、起動しないで error にする", async () => {
  await withProject(async (paths) => {
    const appDir = await writeApp(paths, "comma", { "app.json": APP_JSON, "main.ts": OK_APP });
    const supervisor = new AppSupervisor({
      name: "comma",
      appDir: `${appDir},/etc`,
      dataDir: paths.appDataDir("comma"),
      entry: join(appDir, "main.ts"),
    });
    try {
      await supervisor.start();
      assertEquals(supervisor.status, "error");
      assertStringIncludes(supervisor.error ?? "", ",");
      assertEquals(supervisor.pid, undefined);
      assertFalse(supervisor.logs().some((line) => line.text.startsWith("起動しました")));
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: リンクが走査のあとに置かれても、起動の直前に見つけて起動しない（再起動もしない）", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(paths, "app", OK_APP, { restartBaseMs: 10 });
    const link = join(paths.appsDir, "app", "etc");
    await Deno.symlink("/etc", link);
    try {
      await supervisor.start();
      assertEquals(supervisor.status, "error");
      assertStringIncludes(supervisor.error ?? "", "アプリのフォルダにシンボリックリンクがあります");
      assertStringIncludes(supervisor.error ?? "", "etc");
      assertEquals(supervisor.pid, undefined);
      assertEquals(supervisor.target(), undefined);
      assertFalse(supervisor.logs().some((line) => line.text.startsWith("起動しました")));

      // 再起動の繰り返しにならない
      await new Promise((resolve) => setTimeout(resolve, 100));
      assertEquals(supervisor.status, "error");
      assertEquals(supervisor.logs().filter((line) => line.text.includes("再起動します")).length, 0);

      // リンクを消してもう一度起動すれば動く
      await supervisor.stop();
      await Deno.remove(link);
      await supervisor.start();
      assertEquals(supervisor.status, "running");
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: データフォルダがリンクでも、中にリンクがあっても起動しない", async () => {
  await withProject(async (paths) => {
    const outside = join(paths.root, "outside");
    await Deno.mkdir(outside);

    // データフォルダそのものがリンク
    const linked = await supervisorFor(paths, "linked", OK_APP);
    await Deno.mkdir(join(paths.root, "data", "apps"), { recursive: true });
    await Deno.symlink(outside, paths.appDataDir("linked"));
    // データフォルダの中にリンク
    const inside = await supervisorFor(paths, "inside", OK_APP);
    await Deno.mkdir(paths.appDataDir("inside"), { recursive: true });
    await Deno.symlink("/etc", join(paths.appDataDir("inside"), "etc"));

    try {
      await linked.start();
      assertEquals(linked.status, "error");
      assertStringIncludes(linked.error ?? "", "データフォルダがシンボリックリンクです");
      assertEquals(linked.pid, undefined);

      await inside.start();
      assertEquals(inside.status, "error");
      assertStringIncludes(inside.error ?? "", "データフォルダにシンボリックリンクがあります");
      assertEquals(inside.pid, undefined);
    } finally {
      await linked.stop();
      await inside.stop();
    }
  });
});

Deno.test("supervisor: データフォルダに外のファイルへのハードリンクがあれば起動しない", async () => {
  await withProject(async (paths) => {
    const outside = join(paths.root, "outside.txt");
    await Deno.writeTextFile(outside, "SECRET-CONTENT");
    const supervisor = await supervisorFor(paths, "hard", OK_APP);
    await Deno.mkdir(paths.appDataDir("hard"), { recursive: true });
    const link = join(paths.appDataDir("hard"), "hard.txt");
    await Deno.link(outside, link);
    try {
      await supervisor.start();
      assertEquals(supervisor.status, "error");
      assertStringIncludes(supervisor.error ?? "", "データフォルダにハードリンクがあります");
      assertStringIncludes(supervisor.error ?? "", "hard.txt");
      assertEquals(supervisor.pid, undefined);

      // リンクを消してもう一度起動すれば動く
      await supervisor.stop();
      await Deno.remove(link);
      await supervisor.start();
      assertEquals(supervisor.status, "running");
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: モジュールを取得せず、deno.lock も書き換えない（lock に無い依存・URL の import は読み込めない）", async () => {
  await withProject(async (paths) => {
    // Station の deno.json と deno.lock の写しを使う（元のファイルは書き換えられないことの確認のため）
    const repo = fromFileUrl(new URL("../", import.meta.url));
    const configDir = join(paths.root, "config");
    await Deno.mkdir(configDir);
    for (const file of ["deno.json", "deno.lock"]) await Deno.copyFile(join(repo, file), join(configDir, file));
    const configPath = join(configDir, "deno.json");
    const lockBefore = await Deno.readTextFile(join(configDir, "deno.lock"));
    const realLockBefore = await Deno.readTextFile(join(repo, "deno.lock"));

    // Station の deno.json の imports にある hono は使える
    const hono = await supervisorFor(
      paths,
      "hono-app",
      `import { Hono } from "hono";\nconst app = new Hono();\napp.get("/", (c) => c.text("hono ok"));\nexport default app;`,
      { configPath },
    );
    try {
      await hono.start();
      assertEquals(hono.status, "running", hono.logs().map((line) => line.text).join("\n"));
      assertEquals(await (await authorized(hono, "/")).text(), "hono ok");
    } finally {
      await hono.stop();
    }

    const cases: [string, string][] = [
      // lock に無い npm: は、取得も lock の書き換えもされず、読み込みに失敗する
      [
        "npm-dep",
        `import isOdd from "npm:is-odd@3.0.1";\nexport default { fetch: () => new Response(String(isOdd(3))) };`,
      ],
      // URL の import は取りに行かない（外への通信にならない）
      ["remote", `const m = await import("https://esm.sh/ms@2.1.3?leak=secret");\nexport default m;`],
    ];
    for (const [name, source] of cases) {
      const supervisor = await supervisorFor(paths, name, source, { configPath, crashLimit: 1 });
      try {
        await supervisor.start();
        await waitFor(() => supervisor.status === "error", `${name} が error になる`);
        const errors = supervisor.logs().filter((line) => line.stream === "stderr").map((line) => line.text).join("\n");
        assertStringIncludes(errors, "entry を読み込めません", name);
        assertEquals(supervisor.pid, undefined, name);
      } finally {
        await supervisor.stop();
      }
    }

    assertEquals(await Deno.readTextFile(join(configDir, "deno.lock")), lockBefore);
    assertEquals(await Deno.readTextFile(join(repo, "deno.lock")), realLockBefore);
  });
});

Deno.test("supervisor: 子の出力は Station のログにも出し、Ebina-App-Token と同じ文字列は伏せる", async () => {
  await withProject(async (paths) => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    const source = `const token = Deno.env.get("EBINA_APP_TOKEN");
console.log("hello-stdout token=" + token);
console.error("hello-stderr token=" + token);
export default { fetch: () => new Response("ok") };`;
    const loud = await supervisorFor(paths, "loud", source);
    // 読み込めない entry の理由は標準エラーに出る
    const broken = await supervisorFor(paths, "broken-app", `export default {`, { crashLimit: 1 });
    try {
      await loud.start();
      const token = loud.target()?.token;
      assert(token !== undefined);
      await waitFor(() => lines.some((line) => line.includes("hello-stderr")), "標準エラーがログに出る");
      await waitFor(() => lines.some((line) => line.includes("hello-stdout")), "標準出力がログに出る");

      const stdout = lines.find((line) => line.includes("hello-stdout"));
      const stderr = lines.find((line) => line.includes("hello-stderr"));
      assertStringIncludes(stdout ?? "", "INFO");
      assertStringIncludes(stdout ?? "", "アプリ loud: hello-stdout token=(token)");
      assertStringIncludes(stderr ?? "", "WARN");
      assertStringIncludes(stderr ?? "", "アプリ loud: hello-stderr token=(token)");
      // READY の合図は出さない
      assertFalse(lines.some((line) => line.includes("EBINA_READY")));
      // トークンは、Station のログにも、持っているログにも残らない
      assertFalse(lines.some((line) => line.includes(token)));
      assertFalse(loud.logs().some((line) => line.text.includes(token)));
      assert(loud.logs().some((line) => line.stream === "stdout" && line.text === "hello-stdout token=(token)"));

      // 起動に失敗した理由が Station のログから分かる
      await broken.start();
      await waitFor(() => broken.status === "error", "壊れたアプリが error になる");
      await waitFor(() => lines.some((line) => line.includes("runner: entry を読み込めません")), "理由がログに出る");
      assert(lines.some((line) => line.includes("アプリ broken-app: runner: entry を読み込めません")));
    } finally {
      await loud.stop();
      await broken.stop();
    }
  });
});

Deno.test("supervisor: 長い行を区切る位置にトークンがまたがっても、割れた形で残さない", async () => {
  await withProject(async (paths) => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    // 改行のある行と、改行の来ないまま溜まる出力の両方で、トークンが 8192 文字目をまたぐようにする
    const source = `const token = Deno.env.get("EBINA_APP_TOKEN") ?? "";
const pad = "x".repeat(8192 - Math.floor(token.length / 2));
console.log(pad + token + "-end-line");
await Deno.stdout.write(new TextEncoder().encode("y".repeat(8192 - Math.floor(token.length / 2))));
await Deno.stdout.write(new TextEncoder().encode(token + "z".repeat(9000)));
await Deno.stdout.write(new TextEncoder().encode("-end-stream\\n"));
export default { fetch: () => new Response("ok") };`;
    const app = await supervisorFor(paths, "longline", source);
    try {
      await app.start();
      const token = app.target()?.token;
      assert(token !== undefined);
      await waitFor(() => app.logs().some((line) => line.text.includes("-end-stream")), "長い出力を読み切る");
      // 区切られた行を全部つないでも、トークンは現れない（半分ずつ残っていない）
      const joined = app.logs().map((line) => line.text).join("");
      assertFalse(joined.includes(token), "持っているログにトークンが割れて残っている");
      assertStringIncludes(joined, "(token)-end-line");
      assertStringIncludes(joined, "(token)zzz");
      const logged = lines.map((line) => line.replace(/^.*?アプリ longline: /, "")).join("");
      assertFalse(logged.includes(token), "Station のログにトークンが割れて残っている");
    } finally {
      await app.stop();
    }
  });
});

Deno.test("supervisor: project/data/apps や project/apps がリンクなら起動せず、project の外にフォルダも作らない", async () => {
  await withProject(async (paths) => {
    const outside = await Deno.makeTempDir({ prefix: "ebina-outside-" });
    try {
      // data/apps が project の外を指す
      await Deno.mkdir(join(paths.root, "data"), { recursive: true });
      await Deno.symlink(outside, join(paths.root, "data", "apps"));
      const supervisor = await supervisorFor(paths, "chain", OK_APP, { projectRoot: paths.root });
      try {
        await supervisor.start();
        assertEquals(supervisor.status, "error");
        assertStringIncludes(supervisor.error ?? "", "シンボリックリンク");
        assertEquals(await Array.fromAsync(Deno.readDir(outside)), [], "project の外にフォルダを作った");
      } finally {
        await supervisor.stop();
      }
      await Deno.remove(join(paths.root, "data", "apps"));

      // apps が project の外を指す（アプリ本体を外に置く）
      const realApps = join(outside, "apps");
      await Deno.rename(paths.appsDir, realApps);
      await Deno.symlink(realApps, paths.appsDir);
      const linked = new AppSupervisor({
        name: "chain",
        appDir: join(paths.appsDir, "chain"),
        dataDir: paths.appDataDir("chain"),
        entry: join(paths.appsDir, "chain", "main.ts"),
        projectRoot: paths.root,
      });
      try {
        await linked.start();
        assertEquals(linked.status, "error");
        assertStringIncludes(linked.error ?? "", "シンボリックリンク");
      } finally {
        await linked.stop();
      }
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("supervisor: アプリが改行なしで標準出力に書いても、合図の行とつながらずに running になる", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(
      paths,
      "noeol",
      `await Deno.stdout.write(new TextEncoder().encode("prefix-without-newline"));\nexport default { fetch: () => new Response("ok") };`,
      { startTimeoutMs: 5_000 },
    );
    try {
      await supervisor.start();
      assertEquals(supervisor.status, "running");
      const res = await authorized(supervisor, "/");
      assertEquals(await res.text(), "ok");
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: killSync() はイベントループを塞いだ子も SIGKILL で止め、再起動しない", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(
      paths,
      "busy",
      `export default { fetch: () => { for (;;) {} } };`,
      { restartBaseMs: 10, stopTimeoutMs: 100 },
    );
    try {
      await supervisor.start();
      const pid = supervisor.pid!;
      const target = supervisor.target()!;
      // 塞がる呼び出しは応答が来ない。送りっぱなしにして、あとで中断する
      const abort = new AbortController();
      const pending = fetch(`http://127.0.0.1:${target.port}/`, {
        headers: { "Ebina-App-Token": target.token },
        signal: abort.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
      Deno.kill(pid, "SIGTERM"); // 塞がっているので応じない
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert(isProcessAlive(pid), "塞がった子が SIGTERM で終わっている");

      supervisor.killSync();
      await waitFor(() => !isProcessAlive(pid), "子が SIGKILL で止まる");
      abort.abort();
      await pending;
      await supervisor.stop();
      assertEquals(supervisor.logs().filter((line) => line.text.startsWith("起動しました")).length, 1);
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: beginStop() のあとに子が終わっても再起動せず、警告も出さない", async () => {
  await withProject(async (paths) => {
    const echo = await Deno.readTextFile(new URL("./fixtures/apps/echo/main.ts", import.meta.url));
    const supervisor = await supervisorFor(paths, "app", echo, { restartBaseMs: 10 });
    const warnings: string[] = [];
    try {
      await supervisor.start();
      const pid = supervisor.pid!;
      setLogSink((line) => {
        if (line.includes("WARN") || line.includes("終了しました")) warnings.push(line);
      });
      supervisor.beginStop();
      const crash = await authorized(supervisor, "/__probe/crash");
      await crash.body?.cancel();
      await waitFor(() => !isProcessAlive(pid), "子が終わる");
      await new Promise((resolve) => setTimeout(resolve, 300));
      assertEquals(supervisor.logs().filter((line) => line.text.startsWith("起動しました")).length, 1);
      assertEquals(supervisor.pid, undefined);
      assertFalse(supervisor.logs().some((line) => line.text.includes("再起動します")));
      assertEquals(warnings, []);
      await supervisor.stop();
      assertEquals(supervisor.status, "stopped");
    } finally {
      await supervisor.stop();
    }
  });
});

Deno.test("supervisor: データフォルダは 0700 で作り、既にあるものも 0700 に締める", async () => {
  await withProject(async (paths) => {
    const supervisor = await supervisorFor(paths, "app", OK_APP);
    try {
      await supervisor.start();
      assertEquals((await Deno.stat(paths.appDataDir("app"))).mode! & 0o777, 0o700);
      await supervisor.stop();

      await Deno.chmod(paths.appDataDir("app"), 0o755);
      await supervisor.start();
      assertEquals(supervisor.status, "running");
      assertEquals((await Deno.stat(paths.appDataDir("app"))).mode! & 0o777, 0o700);
    } finally {
      await supervisor.stop();
    }
  });
});
