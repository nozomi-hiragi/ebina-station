import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { loadApp, ManifestError, parseManifest, validateEntryPath } from "../src/apps/manifest.ts";

Deno.test("manifest: label だけで読める", () => {
  assertEquals(parseManifest({ label: "メモ" }), { label: "メモ" });
});

Deno.test("manifest: すべての欄を読み、知らない欄は無視する", () => {
  const manifest = parseManifest({
    label: "  Echo  ",
    version: "1.2.3",
    description: "説明",
    icon: "🔁",
    entry: "main.ts",
    permissions: ["net"],
    extra: { nested: true },
  });
  assertEquals(manifest, { label: "Echo", version: "1.2.3", description: "説明", icon: "🔁", entry: "main.ts" });
});

Deno.test("manifest: 形が違えば日本語の理由で投げる", () => {
  const cases: [unknown, string][] = [
    [null, "オブジェクト"],
    [[], "オブジェクト"],
    ["label", "オブジェクト"],
    [1, "オブジェクト"],
    [{}, "label がありません"],
    [{ label: 1 }, "label は文字列"],
    [{ label: "" }, "label が空"],
    [{ label: " \n\t" }, "label が空"],
    [{ label: "a", version: 1 }, "version は文字列"],
    [{ label: "a", description: null }, "description は文字列"],
    [{ label: "a", icon: ["x"] }, "icon は文字列"],
    [{ label: "a", entry: 1 }, "entry は文字列"],
  ];
  for (const [value, expected] of cases) {
    const error = assertThrows(() => parseManifest(value), ManifestError);
    assertStringIncludes(error.message, expected, JSON.stringify(value));
  }
});

Deno.test("manifest: entry のパスの検査", () => {
  for (const entry of ["main.ts", "src/main.ts", "./main.ts", "a/b/c.js", "日本語.ts", "a..b.ts"]) {
    assertEquals(validateEntryPath(entry), null, entry);
  }
  const bad = [
    "",
    "/abs/main.ts",
    "../main.ts",
    "a/../../main.ts",
    "a/..",
    "a\\b.ts",
    "C:\\x.ts",
    "C:x.ts",
    "a\nb.ts",
    "a\0b",
  ];
  for (const entry of bad) {
    assertEquals(typeof validateEntryPath(entry), "string", JSON.stringify(entry));
    assertThrows(() => parseManifest({ label: "a", entry }), ManifestError, undefined, JSON.stringify(entry));
  }
});

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "ebina-manifest-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function write(dir: string, path: string, text: string): Promise<void> {
  const full = join(dir, path);
  await Deno.mkdir(join(full, ".."), { recursive: true });
  await Deno.writeTextFile(full, text);
}

Deno.test("loadApp: entry だけ・panoplie/ だけ・両方を読める", async () => {
  await withTempDir(async (root) => {
    const entryOnly = join(root, "a");
    await write(entryOnly, "app.json", JSON.stringify({ label: "A", entry: "src/main.ts" }));
    await write(entryOnly, "src/main.ts", "export default { fetch: () => new Response('') };");
    const a = await loadApp(entryOnly);
    assertEquals(a.entry, join(entryOnly, "src", "main.ts"));
    assertEquals(a.panoplieDir, undefined);
    assertEquals(a.appDir, entryOnly);
    assertEquals(a.manifest.label, "A");

    const panoplieOnly = join(root, "b");
    await write(panoplieOnly, "app.json", JSON.stringify({ label: "B" }));
    await write(panoplieOnly, "panoplie/index.bina", "{}");
    const b = await loadApp(panoplieOnly);
    assertEquals(b.entry, undefined);
    assertEquals(b.panoplieDir, join(panoplieOnly, "panoplie"));

    const both = join(root, "c");
    await write(both, "app.json", JSON.stringify({ label: "C", entry: "main.ts" }));
    await write(both, "main.ts", "");
    await write(both, "panoplie/index.bina", "{}");
    const c = await loadApp(both);
    assertEquals(c.entry, join(both, "main.ts"));
    assertEquals(c.panoplieDir, join(both, "panoplie"));
  });
});

Deno.test("loadApp: entry も panoplie/ も無ければ異常", async () => {
  await withTempDir(async (dir) => {
    await write(dir, "app.json", JSON.stringify({ label: "空" }));
    const error = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(error.message, "entry も panoplie/ もありません");
  });
});

Deno.test("loadApp: app.json の不正", async () => {
  await withTempDir(async (dir) => {
    const missing = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(missing.message, "app.json がありません");

    await write(dir, "app.json", "{ label: ");
    const broken = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(broken.message, "JSON として読めません");

    await write(dir, "app.json", "[]");
    const array = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(array.message, "オブジェクト");

    await write(dir, "app.json", JSON.stringify({ label: "大", description: "x".repeat(70 * 1024) }));
    const large = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(large.message, "大きすぎます");
  });
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "app.json"));
    const directory = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(directory.message, "ファイルではありません");
  });
});

Deno.test("loadApp: entry が無い・フォルダ・外を指すものは異常", async () => {
  await withTempDir(async (root) => {
    const dir = join(root, "app");
    await write(dir, "app.json", JSON.stringify({ label: "A", entry: "main.ts" }));
    const missing = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(missing.message, "entry のファイルがありません");

    await Deno.mkdir(join(dir, "main.ts"));
    const folder = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(folder.message, "entry がファイルではありません");
    await Deno.remove(join(dir, "main.ts"));

    // フォルダの外のファイルへのシンボリックリンク
    await write(root, "outside.ts", "");
    await Deno.symlink(join(root, "outside.ts"), join(dir, "main.ts"));
    const escaped = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(escaped.message, "シンボリックリンク");
    await Deno.remove(join(dir, "main.ts"));

    // フォルダの中のファイルへのシンボリックリンクも置けない
    await write(dir, "real.ts", "");
    await Deno.symlink(join(dir, "real.ts"), join(dir, "main.ts"));
    const inside = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(inside.message, "シンボリックリンク");
    await Deno.remove(join(dir, "main.ts"));
    await Deno.rename(join(dir, "real.ts"), join(dir, "main.ts"));
    assert((await loadApp(dir)).entry !== undefined);
  });
});

Deno.test("loadApp: フォルダの中にハードリンクがあれば異常（panoplie/ だけのアプリも）", async () => {
  await withTempDir(async (root) => {
    const dir = join(root, "app");
    await write(dir, "app.json", JSON.stringify({ label: "A" }));
    await write(dir, "panoplie/index.bina", "{}");
    await write(root, "secret.txt", "x");
    assert((await loadApp(dir)).panoplieDir !== undefined);

    await Deno.link(join(root, "secret.txt"), join(dir, "panoplie/hard.txt"));
    const error = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(error.message, "ハードリンクがあります");
    assertStringIncludes(error.message, "panoplie/hard.txt");

    await Deno.remove(join(dir, "panoplie/hard.txt"));
    assert((await loadApp(dir)).panoplieDir !== undefined);
  });
});

Deno.test("loadApp: フォルダの中にシンボリックリンクがあれば異常（Deno の権限はリンクの先を解決しないため）", async () => {
  await withTempDir(async (root) => {
    const dir = join(root, "app");
    await write(dir, "app.json", JSON.stringify({ label: "A", entry: "main.ts" }));
    await write(dir, "main.ts", "");
    await write(root, "secret/station.db", "SQLite format 3");
    assert((await loadApp(dir)).entry !== undefined);

    // フォルダの外のフォルダ・ファイル、絶対パスの / へのリンク
    for (const [name, target] of [["escape", join(root, "secret")], ["etc", "/etc"], ["root", "/"]]) {
      await Deno.symlink(target, join(dir, name));
      const error = await assertRejects(() => loadApp(dir), ManifestError, undefined, name);
      assertStringIncludes(error.message, "シンボリックリンクがあります");
      assertStringIncludes(error.message, name);
      await Deno.remove(join(dir, name));
    }

    // 深いところにあるリンクも、先が存在しないリンクも見つける
    await write(dir, "panoplie/files/deep/keep.txt", "x");
    await Deno.symlink(join(root, "secret"), join(dir, "panoplie/files/deep/link"));
    const deep = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(deep.message, "panoplie/files/deep/link");
    await Deno.remove(join(dir, "panoplie/files/deep/link"));
    await Deno.symlink(join(root, "none"), join(dir, "dangling"));
    await assertRejects(() => loadApp(dir), ManifestError, "シンボリックリンクがあります");
    await Deno.remove(join(dir, "dangling"));

    // 消せば読める
    assert((await loadApp(dir)).panoplieDir !== undefined);
  });
});

Deno.test("loadApp: app.json がシンボリックリンクなら、リンク先を読まずに異常", async () => {
  await withTempDir(async (root) => {
    const dir = join(root, "app");
    await write(root, "other.json", JSON.stringify({ label: "別のファイル" }));
    await write(dir, "panoplie/index.bina", "{}");
    await Deno.symlink(join(root, "other.json"), join(dir, "app.json"));
    const error = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(error.message, "シンボリックリンク");
    // リンク先の内容（label など）が理由に混ざらない
    assert(!error.message.includes("別のファイル"));
  });
});

Deno.test("loadApp: panoplie がシンボリックリンクやファイルなら異常", async () => {
  await withTempDir(async (root) => {
    const dir = join(root, "app");
    await write(dir, "app.json", JSON.stringify({ label: "A" }));
    await write(root, "site/index.bina", "{}");
    await Deno.symlink(join(root, "site"), join(dir, "panoplie"));
    const link = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(link.message, "シンボリックリンク");
    await Deno.remove(join(dir, "panoplie"));

    await write(dir, "panoplie", "ファイル");
    const file = await assertRejects(() => loadApp(dir), ManifestError);
    assertStringIncludes(file.message, "フォルダではありません");
  });
});
