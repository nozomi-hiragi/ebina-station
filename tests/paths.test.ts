import { assertEquals, assertThrows } from "@std/assert";
import { isAbsolute, join, resolve } from "@std/path";
import { projectPaths } from "../src/paths.ts";

/** EBINA_PROJECT_DIR を一時的に差し替えて fn を実行する */
function withProjectDirEnv<T>(value: string | undefined, fn: () => T): T {
  const before = Deno.env.get("EBINA_PROJECT_DIR");
  if (value === undefined) Deno.env.delete("EBINA_PROJECT_DIR");
  else Deno.env.set("EBINA_PROJECT_DIR", value);
  try {
    return fn();
  } finally {
    if (before === undefined) Deno.env.delete("EBINA_PROJECT_DIR");
    else Deno.env.set("EBINA_PROJECT_DIR", before);
  }
}

Deno.test("projectPaths: 引数の root から決まった場所を組み立てる", () => {
  const root = resolve("/tmp/ebina-project-x");
  const p = projectPaths(root);
  assertEquals(p.root, root);
  assertEquals(p.config, join(root, "station.json"));
  assertEquals(p.db, join(root, "data", "station", "station.db"));
  assertEquals(p.appsDir, join(root, "apps"));
  assertEquals(p.appDataDir("echo"), join(root, "data", "apps", "echo"));
});

Deno.test("projectPaths: 相対パスの root は絶対パスにする", () => {
  const p = projectPaths("./some/dir");
  assertEquals(isAbsolute(p.root), true);
  assertEquals(p.root, resolve("./some/dir"));
});

Deno.test("projectPaths: 省略すると EBINA_PROJECT_DIR、それも無ければ ./project", () => {
  withProjectDirEnv("/tmp/from-env", () => {
    assertEquals(projectPaths().root, resolve("/tmp/from-env"));
  });
  withProjectDirEnv(undefined, () => {
    assertEquals(projectPaths().root, resolve("./project"));
  });
  withProjectDirEnv("", () => {
    assertEquals(projectPaths().root, resolve("./project"));
  });
});

Deno.test("projectPaths: appDataDir は形式に合わない名前を拒否する", () => {
  const p = projectPaths("/tmp/ebina-project-x");
  for (const name of ["", "..", "../x", "a/b", "A", "a\\b"]) {
    assertThrows(() => p.appDataDir(name), Error, "アプリ名", name);
  }
});
