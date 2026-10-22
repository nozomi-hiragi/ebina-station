// Binette エディタ（apps/binette-editor）の単体テスト。main.ts の fetch を子プロセスなしで直接呼ぶ
import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { BODY_MAX, createHandler } from "../apps/binette-editor/main.ts";
import { NAME_MAX_LENGTH, nameProblem } from "../apps/binette-editor/names.ts";
import { BINETTE_MAX_COUNT, BinetteStore, InvalidNameError } from "../apps/binette-editor/store.ts";

const BASE = "http://127.0.0.1";

const PAGE = JSON.stringify({
  binette: "0.1",
  title: "テスト",
  entry: "main",
  assets: { main: { type: "html", content: "<p>こんにちは</p>" } },
});

async function withHandler(fn: (call: Caller, dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = await Deno.makeTempDir({ prefix: "ebina-editor-" });
  try {
    const handler = createHandler(dataDir);
    await fn((path, init) => handler(new Request(`${BASE}${path}`, init)), dataDir);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
  }
}

type Caller = (path: string, init?: RequestInit) => Promise<Response>;

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

const put = (call: Caller, name: string, body: string) => call(`/api/binettes/${name}`, { method: "PUT", body });

Deno.test("binette-editor: 名前の規則", () => {
  for (const name of ["a", "a/b", "notes/2026/memo", "A.b_c-d", "x".repeat(64), "..a", "a..b", "a.bin", "index"]) {
    assertEquals(nameProblem(name), null, name);
  }
  const bad = [
    "",
    "/a",
    "a/",
    "a//b",
    ".",
    "..",
    "a/./b",
    "a/../b",
    "../a",
    "a\\b",
    "a b",
    "日本語",
    "a%2fb",
    "a%2e%2e",
    "a?x=1",
    "a#b",
    "a\0b",
    "x".repeat(65),
    `${"a/".repeat(100)}a`,
    "a.bina",
    "a.bina/b",
    "a/b.bina",
  ];
  for (const name of bad) assert(nameProblem(name) !== null, JSON.stringify(name));
  // 全体の上限: 64 文字の区切りを / でつなぎ、ちょうど上限と、1 文字超
  const segment = "a".repeat(63);
  const atLimit = [segment, segment, segment, "a".repeat(NAME_MAX_LENGTH - 3 * 63 - 3)].join("/");
  assertEquals(atLimit.length, NAME_MAX_LENGTH);
  assertEquals(nameProblem(atLimit), null);
  assert(nameProblem(`${atLimit}a`) !== null);
});

Deno.test("binette-editor: 作成・一覧・取得・上書き・削除", async () => {
  await withHandler(async (call, dataDir) => {
    // 何も無いときは空
    let res = await call("/api/binettes");
    assertEquals(res.status, 200);
    assertEquals(await json(res), { names: [] });

    // 作成（201）。入れ子の名前はフォルダになる
    res = await put(call, "b", PAGE);
    assertEquals(res.status, 201);
    assertEquals(await json(res), { name: "b" });
    assertEquals((await put(call, "a/c", PAGE)).status, 201);
    assertEquals((await put(call, "a", PAGE)).status, 201);
    await Deno.stat(join(dataDir, "binette", "a", "c.bina"));
    await Deno.stat(join(dataDir, "binette", "a.bina"));

    // 名前順
    res = await call("/api/binettes");
    assertEquals(await json(res), { names: ["a", "a/c", "b"] });

    // 保存した文字列をそのまま返す（整形し直さない）
    const spaced = `{ "binette": "0.1",\n  "redirect": "/home" }\n`;
    assertEquals((await put(call, "b", spaced)).status, 200);
    res = await call("/api/binettes/b");
    assertEquals(res.status, 200);
    assertMatch(res.headers.get("content-type") ?? "", /^application\/json/);
    assertEquals(await res.text(), spaced);

    // 一時ファイルは残らない
    const files: string[] = [];
    for await (const entry of Deno.readDir(join(dataDir, "binette"))) files.push(entry.name);
    assertEquals(files.sort(), ["a", "a.bina", "b.bina"]);

    // 削除。空になったフォルダは片付き、残りは残る
    assertEquals((await call("/api/binettes/a/c", { method: "DELETE" })).status, 200);
    await Deno.stat(join(dataDir, "binette", "a")).then(() => assert(false, "a/ が残っている"), () => {});
    assertEquals(await json(await call("/api/binettes")), { names: ["a", "b"] });
    // 無いものは 404
    res = await call("/api/binettes/a/c", { method: "DELETE" });
    assertEquals(res.status, 404);
    assert(typeof (await json(res)).error === "string");
    assertEquals((await call("/api/binettes/nothing")).status, 404);
    // 深い入れ子を消すと、空になった親が binette/ の手前まで片付く。binette/ 自体は残る
    assertEquals((await put(call, "x/y/z", PAGE)).status, 201);
    assertEquals((await put(call, "x/keep", PAGE)).status, 201);
    assertEquals((await call("/api/binettes/x/y/z", { method: "DELETE" })).status, 200);
    await Deno.stat(join(dataDir, "binette", "x", "y")).then(() => assert(false, "x/y/ が残っている"), () => {});
    await Deno.stat(join(dataDir, "binette", "x", "keep.bina"));
    for (const name of ["a", "b", "x/keep"]) {
      assertEquals((await call(`/api/binettes/${name}`, { method: "DELETE" })).status, 200);
    }
    await Deno.stat(join(dataDir, "binette"));
    assertEquals(await json(await call("/api/binettes")), { names: [] });
  });
});

Deno.test("binette-editor: 名前が正しくなければ 400（保存も読み書きもしない）", async () => {
  await withHandler(async (call, dataDir) => {
    for (const name of ["a%2f..%2fb", "a//b", "a/", "a.bina", "a%20b", "a%2e%2e", "a%5cb"]) {
      for (const init of [{}, { method: "PUT", body: PAGE }, { method: "DELETE" }]) {
        const res = await call(`/api/binettes/${name}`, init);
        assertEquals(res.status, 400, `${init.method ?? "GET"} ${name}`);
        assert(typeof (await json(res)).error === "string");
      }
    }
    assertEquals((await call("/api/binettes/")).status, 400);
    // dataDir の外にも中にも、何も作られていない
    const entries: string[] = [];
    for await (const entry of Deno.readDir(dataDir)) entries.push(entry.name);
    assertEquals(entries, []);
  });
});

Deno.test("binette-editor: パス・トラバーサルでデータフォルダの外を読めない・書けない・消せない", async () => {
  const parent = await Deno.makeTempDir({ prefix: "ebina-editor-parent-" });
  try {
    const dataDir = join(parent, "data");
    await Deno.mkdir(dataDir);
    const outside = join(parent, "secret.bina");
    await Deno.writeTextFile(outside, PAGE);
    const handler = createHandler(dataDir);
    const call: Caller = (path, init) => handler(new Request(`${BASE}${path}`, init));

    // URL の解釈で .. が畳まれて API の外のパスになるものは 404、残るものは 400。どちらでも外には届かない
    for (const name of ["../secret", "..%2fsecret", "a/../../secret", "%2e%2e/secret", "a/..%5csecret"]) {
      for (const init of [{}, { method: "PUT", body: PAGE }, { method: "DELETE" }]) {
        const res = await call(`/api/binettes/${name}`, init);
        assert(res.status === 400 || res.status === 404, `${init.method ?? "GET"} ${name}: ${res.status}`);
        await res.body?.cancel();
      }
      // プレビューは存在しないものとして 404
      const preview = await call(`/preview/${name}.bina`);
      assertEquals(preview.status, 404, name);
      await preview.body?.cancel();
    }
    // 保存の部品も、名前の規則に合わないものはパスにしない
    const store = new BinetteStore(dataDir);
    for (const name of ["../secret", "a/../../secret", "/abs", "a\\b", ""]) {
      await assertRejects(() => store.read(name), InvalidNameError, undefined, name);
      await assertRejects(() => store.write(name, PAGE), InvalidNameError, undefined, name);
      await assertRejects(() => store.remove(name), InvalidNameError, undefined, name);
    }
    assertEquals(await Deno.readTextFile(outside), PAGE);
    const entries: string[] = [];
    for await (const entry of Deno.readDir(dataDir)) entries.push(entry.name);
    assertEquals(entries, []);
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("binette-editor: 形式の検査に通らなければ 400 で、保存しない", async () => {
  await withHandler(async (call) => {
    const bad: [string, string][] = [
      ["JSON でない", "{ これは JSON ではない"],
      ["配列", "[]"],
      ["バージョン違い", JSON.stringify({ binette: "9.9", redirect: "/" })],
      ["entry も redirect も無い", JSON.stringify({ binette: "0.1" })],
      ["entry の asset が無い", JSON.stringify({ binette: "0.1", entry: "main", assets: {} })],
      ["空", ""],
    ];
    for (const [label, body] of bad) {
      const res = await put(call, "x", body);
      assertEquals(res.status, 400, label);
      const message = (await json(res)).error;
      assert(typeof message === "string" && message.length > 0, label);
    }
    // UTF-8 として読めない本文
    const invalidUtf8 = await call("/api/binettes/x", {
      method: "PUT",
      body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
    });
    assertEquals(invalidUtf8.status, 400);
    assertEquals(await json(await call("/api/binettes")), { names: [] });
    assertEquals((await call("/api/binettes/x")).status, 404);

    // 既存のビネットは、不正な上書きで壊れない
    assertEquals((await put(call, "x", PAGE)).status, 201);
    assertEquals((await put(call, "x", "{")).status, 400);
    assertEquals(await (await call("/api/binettes/x")).text(), PAGE);
  });
});

Deno.test("binette-editor: 本文が 1 MiB を超えたら 413（ちょうど 1 MiB は通る）", async () => {
  await withHandler(async (call) => {
    const padded = (size: number) => {
      const base = JSON.stringify({ binette: "0.1", redirect: "/" });
      return base.slice(0, -1) + ` ${" ".repeat(size - base.length - 1)}}`;
    };
    const exact = padded(BODY_MAX);
    assertEquals(new TextEncoder().encode(exact).length, BODY_MAX);
    assertEquals((await put(call, "big", exact)).status, 201);

    const over = await put(call, "big2", padded(BODY_MAX + 1));
    assertEquals(over.status, 413);
    assert(typeof (await json(over)).error === "string");
    assertEquals((await call("/api/binettes/big2")).status, 404);

    // 長さを申告しない（ストリーム）本文でも、超えたところで止める
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new Uint8Array(256 * 1024).fill(0x20);
        for (let i = 0; i < 6; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const streamed = await call("/api/binettes/big3", { method: "PUT", body: stream });
    assertEquals(streamed.status, 413);
    assertEquals(await json(await call("/api/binettes")), { names: ["big"] });
  });
});

Deno.test("binette-editor: プレビューは保存したビネットをそのまま返す", async () => {
  await withHandler(async (call) => {
    assertEquals((await put(call, "notes/hello", PAGE)).status, 201);
    const res = await call("/preview/notes/hello.bina");
    assertEquals(res.status, 200);
    assertMatch(res.headers.get("content-type") ?? "", /^application\/json/);
    assertEquals(await res.text(), PAGE);

    const head = await call("/preview/notes/hello.bina", { method: "HEAD" });
    assertEquals(head.status, 200);
    assertEquals(await head.text(), "");

    // 無い・名前が正しくない・.bina が無い・書き込みは 404 か 405
    assertEquals((await call("/preview/none.bina")).status, 404);
    assertEquals((await call("/preview/notes/hello")).status, 404);
    assertEquals((await call("/preview/.bina")).status, 404);
    assertEquals((await call("/preview/notes/hello.bina.bina")).status, 404);
    assertEquals((await call("/preview/notes/hello.bina", { method: "PUT", body: PAGE })).status, 405);
    assertEquals((await call("/preview/notes/hello.bina", { method: "DELETE" })).status, 405);
  });
});

Deno.test("binette-editor: 知らないパス・メソッドは 404 / 405（画面のファイルは panoplie 側で配る）", async () => {
  await withHandler(async (call) => {
    for (const path of ["/", "/index.bina", "/edit.bina", "/files/list.js", "/api", "/api/other", "/api/binettesx"]) {
      const res = await call(path);
      assertEquals(res.status, 404, path);
      await res.body?.cancel();
    }
    for (
      const [path, method] of [["/api/binettes", "POST"], ["/api/binettes", "DELETE"], ["/api/binettes/a", "POST"]]
    ) {
      const res = await call(path, { method });
      assertEquals(res.status, 405, `${method} ${path}`);
      assert(res.headers.has("allow"));
      await res.body?.cancel();
    }
  });
});

Deno.test("binette-editor: 一覧は形式に合わないファイルとシンボリックリンクを含めない", async () => {
  await withHandler(async (call, dataDir) => {
    assertEquals((await put(call, "ok", PAGE)).status, 201);
    const root = join(dataDir, "binette");
    await Deno.writeTextFile(join(root, "bad name.bina"), PAGE);
    await Deno.writeTextFile(join(root, "ok.bina.tmp-1234"), PAGE);
    await Deno.writeTextFile(join(root, "note.txt"), "x");
    await Deno.symlink(join(root, "ok.bina"), join(root, "link.bina"));
    await Deno.mkdir(join(root, "dir"));
    await Deno.writeTextFile(join(root, "dir", "inner.bina"), PAGE);
    assertEquals(await json(await call("/api/binettes")), { names: ["dir/inner", "ok"] });
  });
});

Deno.test("binette-editor: 同じフォルダの PUT と DELETE を並べても 500 にならない", async () => {
  await withHandler(async (call) => {
    const results: number[] = [];
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < 300; i++) {
      const name = `dir/n${i % 5}`;
      const init: RequestInit = i % 2 === 0 ? { method: "PUT", body: PAGE } : { method: "DELETE" };
      jobs.push(
        call(`/api/binettes/${name}`, init).then(async (res) => {
          results.push(res.status);
          await res.body?.cancel();
        }),
      );
    }
    await Promise.all(jobs);
    assertEquals(results.length, 300);
    for (const status of results) assert([200, 201, 404].includes(status), `status ${status}`);
  });
});

Deno.test("binette-editor: 同じ新しい名前への同時 PUT で、201 は 1 つだけ", async () => {
  await withHandler(async (call) => {
    const responses = await Promise.all(Array.from({ length: 50 }, () => put(call, "same/name", PAGE)));
    const statuses = responses.map((res) => res.status);
    for (const res of responses) await res.body?.cancel();
    assertEquals(statuses.filter((s) => s === 201).length, 1);
    assertEquals(statuses.filter((s) => s === 200).length, 49);
    // If-None-Match: * なら、同時でも作れるのは 1 つで、あとは 412
    const creates = await Promise.all(
      Array.from(
        { length: 20 },
        () => call("/api/binettes/only", { method: "PUT", body: PAGE, headers: { "If-None-Match": "*" } }),
      ),
    );
    const created = creates.map((res) => res.status);
    assertEquals(created.filter((s) => s === 201).length, 1);
    assertEquals(created.filter((s) => s === 412).length, 19);
    const failed = creates.find((res) => res.status === 412);
    assertMatch(String((await json(failed!)).error), /すでにあります/);
    for (const res of creates) await res.body?.cancel().catch(() => {});
  });
});

Deno.test("binette-editor: If-None-Match: * は、無ければ作り、あれば 412 で上書きしない", async () => {
  await withHandler(async (call) => {
    const create = (body: string) =>
      call("/api/binettes/x", { method: "PUT", body, headers: { "If-None-Match": "*" } });
    assertEquals((await create(PAGE)).status, 201);
    const other = JSON.stringify({ binette: "0.1", redirect: "/other" });
    const res = await create(other);
    assertEquals(res.status, 412);
    assertMatch(String((await json(res)).error), /すでにあります/);
    assertEquals(await (await call("/api/binettes/x")).text(), PAGE);
    // ヘッダーが無ければ上書きできる
    assertEquals((await put(call, "x", other)).status, 200);
  });
});

Deno.test("binette-editor: 件数が上限なら新しく作れず 409。上書きと削除はできる", async () => {
  const dataDir = await Deno.makeTempDir({ prefix: "ebina-editor-" });
  try {
    const handler = createHandler(dataDir, { maxCount: 3 });
    const call: Caller = (path, init) => handler(new Request(`${BASE}${path}`, init));
    for (const name of ["a", "b", "c/d"]) assertEquals((await put(call, name, PAGE)).status, 201);
    const full = await put(call, "e", PAGE);
    assertEquals(full.status, 409);
    assertMatch(String((await json(full)).error), /3 件まで/);
    assertEquals((await call("/api/binettes/e")).status, 404);
    // 既存の上書きは許す
    assertEquals((await put(call, "a", PAGE)).status, 200);
    // 消せば作れる
    assertEquals((await call("/api/binettes/b", { method: "DELETE" })).status, 200);
    assertEquals((await put(call, "e", PAGE)).status, 201);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("binette-editor: 既定の上限（1000 件）でも、一覧の応答は中継の上限 1 MiB に収まる", () => {
  assertEquals(BINETTE_MAX_COUNT, 1000);
  const longest = "a".repeat(63) + "/" + "b".repeat(63) + "/" + "c".repeat(63) + "/" + "d".repeat(8);
  assertEquals(longest.length, NAME_MAX_LENGTH);
  const body = JSON.stringify({ names: Array.from({ length: BINETTE_MAX_COUNT }, () => longest) });
  assert(new TextEncoder().encode(body).byteLength < 1024 * 1024 / 4);
});

Deno.test("binette-editor: プレビューは settings を除く。読めないものはそのまま", async () => {
  await withHandler(async (call, dataDir) => {
    const withSettings = JSON.stringify({
      binette: "0.1",
      title: "設定つき",
      entry: "main",
      assets: { main: { type: "html", content: "<p>x</p>" } },
      settings: [{ title: "下書き", order: 10, type: "element", component: "logout" }],
    });
    assertEquals((await put(call, "s", withSettings)).status, 201);
    let res = await call("/preview/s.bina");
    const previewed = JSON.parse(await res.text());
    assertEquals("settings" in previewed, false);
    assertEquals(previewed.title, "設定つき");
    assertEquals(previewed.entry, "main");
    // HEAD も同じ。API の取得は保存したまま
    res = await call("/preview/s.bina", { method: "HEAD" });
    assertEquals(res.status, 200);
    await res.body?.cancel();
    assertEquals(await (await call("/api/binettes/s")).text(), withSettings);
    // settings が無ければ、整形も含めて保存したまま
    const spaced = `{ "binette": "0.1",\n  "redirect": "/home" }\n`;
    assertEquals((await put(call, "p", spaced)).status, 201);
    assertEquals(await (await call("/preview/p.bina")).text(), spaced);
    // 検査に通らず保存できない形で直接置かれたファイルは、そのまま返す
    await Deno.writeTextFile(join(dataDir, "binette", "broken.bina"), "{ not json");
    assertEquals(await (await call("/preview/broken.bina")).text(), "{ not json");
  });
});
