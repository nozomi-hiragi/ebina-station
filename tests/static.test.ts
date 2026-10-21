import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { parseBinette } from "@binette/core";
import { join } from "@std/path";
import { createStaticSite } from "../src/apps/static.ts";
import { FIXTURE_APPS_DIR } from "./fixtures/mod.ts";

const decoder = new TextDecoder();
const text = (body: Uint8Array | undefined) => decoder.decode(body ?? new Uint8Array(0));

Deno.test("static: notes の panoplie/ を配る", async () => {
  const site = await createStaticSite(join(FIXTURE_APPS_DIR, "notes", "panoplie"));

  const index = await site.handle("GET", "/index.bina");
  assertEquals(index.status, 200);
  assertEquals(index.headers?.find(([name]) => name === "content-type")?.[1], "application/json; charset=utf-8");
  assertEquals(parseBinette(text(index.body)).title, "メモ");

  // クエリは無視する
  assertEquals((await site.handle("GET", "/index.bina?x=1")).status, 200);

  const file = await site.handle("GET", "/files/hello.txt");
  assertEquals(file.status, 200);
  assertEquals(text(file.body), "こんにちは、メモです。\n");

  const head = await site.handle("HEAD", "/files/hello.txt");
  assertEquals(head.status, 200);
  assertEquals(head.body?.byteLength, 0);
});

Deno.test("static: 無いもの・許されないメソッド・変なパス", async () => {
  const site = await createStaticSite(join(FIXTURE_APPS_DIR, "notes", "panoplie"));
  // `..` は URL の正規化で panoplie/ の外へは出られず、panoplie/ に無いファイルは 404
  for (
    const path of [
      "/nope.bina",
      "/files/none.txt",
      "/",
      "/files",
      "/../app.json",
      "/%2e%2e/app.json",
    ]
  ) {
    assertEquals((await site.handle("GET", path)).status, 404, path);
  }
  assertEquals((await site.handle("POST", "/index.bina")).status, 405);
  assertEquals((await site.handle("DELETE", "/files/hello.txt")).status, 405);
  // fetch が受け付けないメソッドは 404
  assertEquals((await site.handle("TRACE", "/index.bina")).status, 404);
});

Deno.test("static: . で始まるファイルは配らない・不正な .bina は作れない", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ebina-static-" });
  try {
    await Deno.writeTextFile(join(dir, "index.bina"), JSON.stringify({ binette: "0.1", redirect: "/home" }));
    await Deno.writeTextFile(join(dir, ".secret"), "秘密");
    await Deno.mkdir(join(dir, ".git"));
    await Deno.writeTextFile(join(dir, ".git", "config"), "秘密");
    const site = await createStaticSite(dir);
    assertEquals((await site.handle("GET", "/index.bina")).status, 200);
    assertEquals((await site.handle("GET", "/.secret")).status, 404);
    assertEquals((await site.handle("GET", "/.git/config")).status, 404);

    await Deno.writeTextFile(join(dir, "broken.bina"), "{ JSON ではない");
    const error = await assertRejects(() => createStaticSite(dir));
    assert(error instanceof Error);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("static: 作った後に増えたファイルは配らない（作り直すまで）", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ebina-static-" });
  try {
    await Deno.writeTextFile(join(dir, "a.txt"), "a");
    const site = await createStaticSite(dir);
    await Deno.writeTextFile(join(dir, "b.txt"), "b");
    assertEquals((await site.handle("GET", "/a.txt")).status, 200);
    assertEquals((await site.handle("GET", "/b.txt")).status, 404);
    assertEquals((await (await createStaticSite(dir)).handle("GET", "/b.txt")).status, 200);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("static: 配れない大きさ（1 MiB 超）のファイルがあれば、読み込まずに投げる", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ebina-static-" });
  try {
    await Deno.mkdir(join(dir, "files", "deep"), { recursive: true });
    await Deno.writeTextFile(join(dir, "index.bina"), JSON.stringify({ binette: "0.1", redirect: "/home" }));
    // 上限ちょうどは配れる
    await Deno.writeFile(join(dir, "files", "limit.bin"), new Uint8Array(1024 * 1024));
    const site = await createStaticSite(dir);
    const limit = await site.handle("GET", "/files/limit.bin");
    assertEquals(limit.status, 200);
    assertEquals(limit.body?.byteLength, 1024 * 1024);

    await Deno.writeFile(join(dir, "files", "deep", "big.bin"), new Uint8Array(1024 * 1024 + 1));
    const error = await assertRejects(() => createStaticSite(dir, "demo"), Error);
    assertStringIncludes(error.message, "files/deep/big.bin が大きすぎます");
    assertStringIncludes(error.message, "1 MiB");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
