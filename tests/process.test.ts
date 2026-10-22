// コマンドとして実際に起動する（deno task start / user と同じ権限）。終了コード、案内、シグナルでの終了を確かめる
import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { makeProject, type TestProject } from "./fixtures/mod.ts";
import { testConfigJson } from "./helpers/station.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const CONFIG = fromFileUrl(new URL("../deno.json", import.meta.url));
const MAIN = fromFileUrl(new URL("../src/main.ts", import.meta.url));
const USER_CLI = fromFileUrl(new URL("../src/cli/main.ts", import.meta.url));

const decoder = new TextDecoder();

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** deno を起動する。権限はテストごとに指定する（-A は使わない） */
function spawnDeno(permissions: string[], script: string, args: string[], project: TestProject) {
  return new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-prompt", `--config=${CONFIG}`, ...permissions, script, ...args],
    cwd: REPO_ROOT,
    env: { EBINA_PROJECT_DIR: project.paths.root },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
}

async function runDeno(permissions: string[], script: string, args: string[], project: TestProject): Promise<Result> {
  const output = await spawnDeno(permissions, script, args, project).output();
  return { code: output.code, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) };
}

/** OS が選んだ空きポート（閉じてから使うので、取り合いになる余地はごくわずかにある） */
function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

const STATION_PERMISSIONS = (project: TestProject) => [
  "--allow-net",
  "--allow-read",
  `--allow-write=${project.paths.root}`,
  "--allow-env",
  "--allow-run",
];

Deno.test("process: station.json が無いと、例の場所を案内して終了コード 1", async () => {
  const project = await makeProject([]);
  try {
    const result = await runDeno(STATION_PERMISSIONS(project), MAIN, [], project);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "設定ファイルが見つかりません");
    assertStringIncludes(result.stderr, "examples/station.json");
    // 設定が読めない段階では DB を作らない
    await Deno.stat(project.paths.db).then(() => assert(false, "DB が作られている"), () => {});
  } finally {
    await project.dispose();
  }
});

Deno.test("process: 書き込み権限が無いと、deno task の権限の案内を出して終了コード 1", async () => {
  const project = await makeProject([]);
  try {
    await Deno.writeTextFile(project.paths.config, JSON.stringify(testConfigJson({ port: freePort() })));
    const result = await runDeno(["--allow-net", "--allow-read", "--allow-env", "--allow-run"], MAIN, [], project);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "に書き込めません");
    assertStringIncludes(result.stderr, "--allow-write=<場所>");
  } finally {
    await project.dispose();
  }
});

Deno.test("process: 起動して応え、SIGTERM と SIGINT が続けて届いても片付けて終了コード 0", async () => {
  const project = await makeProject(["echo", "notes"]);
  try {
    const port = freePort();
    await Deno.writeTextFile(project.paths.config, JSON.stringify(testConfigJson({ port })));
    const child = spawnDeno(STATION_PERMISSIONS(project), MAIN, [], project).spawn();

    let status: number | undefined;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/ebina/register/info?token=invalid`);
        status = res.status;
        await res.body?.cancel();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    // Ctrl-C のあと deno --watch が SIGTERM も送ってくる。続けて届いたシグナルで、片付けを打ち切らない
    child.kill("SIGTERM");
    child.kill("SIGINT");
    const output = await child.output();
    const stdout = decoder.decode(output.stdout);
    const stderr = decoder.decode(output.stderr);

    assertEquals(status, 404, stderr);
    assertEquals(output.code, 0, stderr);
    assertMatch(stdout, /Station を起動しました: http:\/\/localhost:\d+/);
    assertMatch(stdout, /(SIGTERM|SIGINT) を受け取りました。終了します/);
    assertStringIncludes(stdout, "Station を止めました");
    assert(!stdout.includes("もう一度受け取りました"), "続けて届いたシグナルで強制終了している");
    assertEquals(stderr, "");
  } finally {
    await project.dispose();
  }
});

Deno.test("process: deno task user と同じ権限で add / list / token / remove が動く", async () => {
  const project = await makeProject([]);
  try {
    await Deno.writeTextFile(project.paths.config, JSON.stringify(testConfigJson()));
    const permissions = ["--allow-read", `--allow-write=${project.paths.root}`, "--allow-env"];

    const added = await runDeno(permissions, USER_CLI, ["add", "alice", "Alice"], project);
    assertEquals(added.code, 0, added.stderr);
    assertStringIncludes(added.stdout, "ユーザー alice（Alice）を作成しました。");
    assertMatch(added.stdout, /http:\/\/localhost:5173\/ebina-station\/register\?server=.+&token=[\w-]{43}\n/);
    assertMatch(added.stdout, /確認コード: \d{4}/);

    const list = await runDeno(permissions, USER_CLI, ["list"], project);
    assertEquals(list.code, 0, list.stderr);
    assertMatch(list.stdout, /alice\s+Alice\s+0/);

    const token = await runDeno(permissions, USER_CLI, ["token", "alice", "--with-code"], project);
    assertEquals(token.code, 0, token.stderr);
    assertMatch(token.stdout, /&code=\d{4}/);

    const removed = await runDeno(permissions, USER_CLI, ["remove", "alice", "--yes"], project);
    assertEquals(removed.code, 0, removed.stderr);
    const empty = await runDeno(permissions, USER_CLI, ["list"], project);
    assertStringIncludes(empty.stdout, "ユーザーはいません");

    const usage = await runDeno(permissions, USER_CLI, ["nothing"], project);
    assertEquals(usage.code, 2);
  } finally {
    await project.dispose();
  }
});

Deno.test("process: CLI は書き込み権限が無いと、権限の案内を出して終了コード 1", async () => {
  const project = await makeProject([]);
  try {
    await Deno.writeTextFile(project.paths.config, JSON.stringify(testConfigJson()));
    const result = await runDeno(["--allow-read", "--allow-env"], USER_CLI, ["add", "alice", "Alice"], project);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "権限が足りません");
    assertStringIncludes(result.stderr, "--allow-write=<場所>");
  } finally {
    await project.dispose();
  }
});

Deno.test("process: ポートが使用中なら、アプリを起動せずに案内を出して終了コード 1", async () => {
  const project = await makeProject(["echo"]);
  const occupied = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    const { port } = occupied.addr as Deno.NetAddr;
    await Deno.writeTextFile(project.paths.config, JSON.stringify(testConfigJson({ port })));
    const result = await runDeno(STATION_PERMISSIONS(project), MAIN, [], project);
    assertEquals(result.code, 1, result.stderr);
    assertStringIncludes(result.stderr, `ポート ${port} は使用中です`);
    assertStringIncludes(result.stderr, "station.json の port を変えるか、使っているプロセスを止めてください");
    // アプリを読み込む前に失敗する（子プロセスを起動しない）
    assert(!result.stdout.includes("アプリを"), result.stdout);
    assert(!result.stdout.includes("Station を起動しました"), result.stdout);
  } finally {
    occupied.close();
    await project.dispose();
  }
});

Deno.test("process: CLI の list は DB が無いとき、作らずに案内して終了コード 1", async () => {
  const project = await makeProject([]);
  try {
    const permissions = ["--allow-read", `--allow-write=${project.paths.root}`, "--allow-env"];
    const result = await runDeno(permissions, USER_CLI, ["list"], project);
    assertEquals(result.code, 1, result.stderr);
    assertStringIncludes(result.stderr, project.paths.db);
    assertStringIncludes(result.stderr, "EBINA_PROJECT_DIR");
    await Deno.stat(project.paths.db).then(() => assert(false, "DB が作られている"), () => {});
  } finally {
    await project.dispose();
  }
});
