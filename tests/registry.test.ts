import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { setLogSink } from "../src/log.ts";
import { scanAllApps, scanApps } from "../src/apps/registry.ts";
import { BUNDLED_APPS_DIR } from "../src/paths.ts";
import { makeProject, writeApp } from "./fixtures/mod.ts";

function captureLogs(): { lines: string[]; restore(): void } {
  const lines: string[] = [];
  setLogSink((line) => lines.push(line));
  return { lines, restore: () => setLogSink(undefined) };
}

Deno.test("registry: apps/ が無ければ空", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ebina-registry-" });
  try {
    assertEquals(await scanApps(join(dir, "apps")), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("registry: フォルダを走査して、使えるものと異常なものを名前順に返す", async () => {
  const project = await makeProject();
  const logs = captureLogs();
  try {
    const { paths } = project;
    const entryApp = { "app.json": JSON.stringify({ label: "動く", entry: "main.ts" }), "main.ts": "" };
    await writeApp(paths, "zeta", { "app.json": JSON.stringify({ label: "静的" }), "panoplie/index.bina": "{}" });
    await writeApp(paths, "alpha", entryApp);
    await writeApp(paths, "mid-1", entryApp);
    // アプリではない・無視するもの
    await writeApp(paths, ".hidden", entryApp);
    await writeApp(paths, "no-manifest", { "main.ts": "" });
    await writeApp(paths, "Bad_Name", entryApp);
    await Deno.writeTextFile(join(paths.appsDir, "file.txt"), "ファイル");
    await Deno.symlink(join(paths.appsDir, "alpha"), join(paths.appsDir, "linked"));
    // 異常として見せるもの
    await writeApp(paths, "settings", entryApp);
    await writeApp(paths, "broken-json", { "app.json": "{ これはJSONではない" });
    await writeApp(paths, "empty", { "app.json": JSON.stringify({ label: "空" }) });

    const apps = await scanApps(paths.appsDir);
    assertEquals(apps.map((app) => app.name), ["alpha", "broken-json", "empty", "mid-1", "settings", "zeta"]);
    const byName = Object.fromEntries(apps.map((app) => [app.name, app]));

    for (const name of ["alpha", "mid-1", "zeta"]) {
      assertEquals(byName[name].error, undefined, name);
      assert(byName[name].loaded !== undefined, name);
      assertEquals(byName[name].dir, join(paths.appsDir, name));
    }
    assertEquals(byName.alpha.loaded?.manifest.label, "動く");
    assertEquals(byName.alpha.loaded?.entry, join(paths.appsDir, "alpha", "main.ts"));
    assertEquals(byName.zeta.loaded?.panoplieDir, join(paths.appsDir, "zeta", "panoplie"));

    assertStringIncludes(byName.settings.error ?? "", "予約");
    assertStringIncludes(byName["broken-json"].error ?? "", "JSON として読めません");
    assertStringIncludes(byName.empty.error ?? "", "entry も panoplie/ もありません");
    for (const name of ["settings", "broken-json", "empty"]) assertEquals(byName[name].loaded, undefined, name);

    // 形式に合わない名前だけ警告を出す（.hidden・リンク・app.json の無いフォルダ・ファイルは黙って無視）
    const warnings = logs.lines.filter((line) => line.includes("WARN"));
    assertEquals(warnings.length, 1, warnings.join("\n"));
    assertStringIncludes(warnings[0], "Bad_Name");
  } finally {
    logs.restore();
    await project.dispose();
  }
});

Deno.test("registry: 同梱の fixtures（echo・notes・broken）", async () => {
  const project = await makeProject(["echo", "notes", "broken"]);
  try {
    const apps = await scanApps(project.paths.appsDir);
    assertEquals(apps.map((app) => app.name), ["broken", "echo", "notes"]);
    assertStringIncludes(apps[0].error ?? "", "label");
    assertEquals(apps[1].loaded?.manifest, {
      label: "Echo",
      version: "0.0.1",
      description: "受けたリクエストを返すテスト用のアプリ",
      icon: "🔁",
      entry: "main.ts",
    });
    assertEquals(apps[1].loaded?.panoplieDir, undefined);
    assertEquals(apps[2].loaded?.entry, undefined);
    assertEquals(apps[2].loaded?.panoplieDir, join(project.paths.appsDir, "notes", "panoplie"));
  } finally {
    await project.dispose();
  }
});

Deno.test("registry: 同梱と project の両方を走査し、同じ名前は project を使ってログに残す", async () => {
  const bundled = await makeProject();
  const own = await makeProject();
  const logs = captureLogs();
  try {
    const entryApp = { "app.json": JSON.stringify({ label: "同梱", entry: "main.ts" }), "main.ts": "" };
    await writeApp(bundled.paths, "alpha", entryApp);
    await writeApp(bundled.paths, "shared", entryApp);
    await writeApp(own.paths, "shared", {
      "app.json": JSON.stringify({ label: "自分の" }),
      "panoplie/index.bina": "{}",
    });
    await writeApp(own.paths, "beta", entryApp);
    // project 側の異常なアプリも、同名の同梱を隠す（使う側が決める）
    await writeApp(bundled.paths, "gamma", entryApp);
    await writeApp(own.paths, "gamma", { "app.json": "{ 壊れた" });

    const apps = await scanAllApps(bundled.paths.appsDir, own.paths.appsDir);
    assertEquals(apps.map((app) => app.name), ["alpha", "beta", "gamma", "shared"]);
    const byName = Object.fromEntries(apps.map((app) => [app.name, app]));
    assertEquals(byName.alpha.dir, join(bundled.paths.appsDir, "alpha"));
    assertEquals(byName.beta.dir, join(own.paths.appsDir, "beta"));
    assertEquals(byName.shared.dir, join(own.paths.appsDir, "shared"));
    assertEquals(byName.shared.loaded?.manifest.label, "自分の");
    assert(byName.gamma.error !== undefined);

    const overrides = logs.lines.filter((line) => line.includes("同梱のアプリ"));
    assertEquals(overrides.length, 2);
    assertStringIncludes(overrides.join("\n"), "shared");
  } finally {
    logs.restore();
    await bundled.dispose();
    await own.dispose();
  }
});

Deno.test("registry: 同梱の置き場所が無い・指定しないときは project だけ", async () => {
  const own = await makeProject();
  try {
    await writeApp(own.paths, "only", { "app.json": JSON.stringify({ label: "唯一" }), "panoplie/index.bina": "{}" });
    assertEquals((await scanAllApps(undefined, own.paths.appsDir)).map((app) => app.name), ["only"]);
    const missing = join(own.paths.root, "no-such-dir");
    assertEquals((await scanAllApps(missing, own.paths.appsDir)).map((app) => app.name), ["only"]);
  } finally {
    await own.dispose();
  }
});

Deno.test("registry: リポジトリの apps/ に Binette エディタが同梱されている", async () => {
  const apps = await scanAllApps(BUNDLED_APPS_DIR, join(BUNDLED_APPS_DIR, "..", "no-such-project-apps"));
  const editor = apps.find((app) => app.name === "binette-editor");
  assertEquals(editor?.error, undefined);
  assertEquals(editor?.loaded?.manifest.entry, "main.ts");
  assert(editor?.loaded?.panoplieDir !== undefined);
});
