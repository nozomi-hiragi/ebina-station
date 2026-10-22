import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { setLogSink } from "../src/log.ts";
import { scanApps } from "../src/apps/registry.ts";
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
