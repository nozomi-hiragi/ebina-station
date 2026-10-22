import { assertEquals, assertInstanceOf, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { ConfigError, loadStationConfig, parseStationConfig } from "../src/config.ts";

const valid = {
  port: 8787,
  origins: ["http://localhost:5173"],
  rpId: "localhost",
  frontURL: "http://localhost:5173/ebina-station",
  serverURL: "http://localhost:8787",
};

/** valid を土台に、欄を書き換えた値を作る。undefined を渡した欄は取り除く */
function withFields(fields: Record<string, unknown>): Record<string, unknown> {
  const value: Record<string, unknown> = { ...valid, ...fields };
  for (const [key, v] of Object.entries(fields)) {
    if (v === undefined) delete value[key];
  }
  return value;
}

function assertConfigError(value: unknown, field: string | undefined, includes?: string) {
  const e = assertThrows(() => parseStationConfig(value), ConfigError);
  assertEquals(e.field, field);
  if (includes) assertStringIncludes(e.message, includes);
}

Deno.test("config: 必須欄だけで読め、既定値が入る", () => {
  assertEquals(parseStationConfig(valid), {
    port: 8787,
    origins: ["http://localhost:5173"],
    rpId: "localhost",
    rpName: "EbinaStation",
    frontURL: "http://localhost:5173/ebina-station",
    serverURL: "http://localhost:8787",
    entrance: {},
  });
});

Deno.test("config: 同梱の examples/station.json が読める", async () => {
  const path = fromFileUrl(new URL("../examples/station.json", import.meta.url));
  const config = await loadStationConfig(path);
  assertEquals(config.port, 8787);
  assertEquals(config.origins, ["http://localhost:5173"]);
  assertEquals(config.rpId, "localhost");
  assertEquals(config.frontURL, "http://localhost:5173/ebina-station");
  assertEquals(config.serverURL, "http://localhost:8787");
});

Deno.test("config: 全部の欄を書いた例（docs/station-json.md）", () => {
  const config = parseStationConfig({
    port: 3456,
    origins: ["https://nozomi-hiragi.github.io"],
    rpId: "nozomi-hiragi.github.io",
    rpName: "うちの Station",
    frontURL: "https://nozomi-hiragi.github.io/ebina-station",
    serverURL: "https://station.example.com",
    entrance: { redirect: "/binette-editor" },
  });
  assertEquals(config.rpName, "うちの Station");
  assertEquals(config.entrance, { redirect: "/binette-editor" });
});

Deno.test("config: 知らない欄は無視する", () => {
  const config = parseStationConfig({ ...valid, future: { a: 1 } });
  assertEquals("future" in config, false);
});

Deno.test("config: オブジェクトでなければ ConfigError", () => {
  for (const value of [null, undefined, 1, "x", [], [valid]]) {
    assertConfigError(value, undefined, "オブジェクト");
  }
});

Deno.test("config: port は 1〜65535 の整数", () => {
  for (const port of [0, 65536, -1, 1.5, "8787", null, NaN]) {
    assertConfigError(withFields({ port }), "port", "1〜65535");
  }
  assertConfigError(withFields({ port: undefined }), "port", "ありません");
  assertEquals(parseStationConfig(withFields({ port: 1 })).port, 1);
  assertEquals(parseStationConfig(withFields({ port: 65535 })).port, 65535);
});

Deno.test("config: origins は正規化し、重複を除く", () => {
  const config = parseStationConfig(
    withFields({
      origins: ["HTTP://Localhost:5173", "http://localhost:5173/", "https://localhost:5174", "https://localhost:443"],
    }),
  );
  assertEquals(config.origins, ["http://localhost:5173", "https://localhost:5174", "https://localhost"]);
  for (const origin of config.origins) assertEquals(new URL(origin).origin, origin);
});

Deno.test("config: origins の不正", () => {
  assertConfigError(withFields({ origins: undefined }), "origins", "ありません");
  assertConfigError(withFields({ origins: [] }), "origins");
  assertConfigError(withFields({ origins: "http://localhost:5173" }), "origins");
  assertConfigError(withFields({ origins: [1] }), "origins[0]");
  assertConfigError(withFields({ origins: ["localhost:5173"] }), "origins[0]");
  assertConfigError(withFields({ origins: ["not a url"] }), "origins[0]", "URL として読めません");
  assertConfigError(withFields({ origins: ["ftp://localhost"] }), "origins[0]", "http");
  // 2 つ目が悪いときは添字が 1
  assertConfigError(
    withFields({ origins: ["http://localhost:5173", "http://localhost/ebina"] }),
    "origins[1]",
    "origin",
  );
  assertConfigError(withFields({ origins: ["http://localhost:5173/?a=1"] }), "origins[0]");
  assertConfigError(withFields({ origins: ["http://user:pw@localhost:5173"] }), "origins[0]");
});

Deno.test("config: http の origin はローカルだけ（WebAuthn は安全な文脈でしか使えない）", () => {
  for (const origin of ["http://example.com", "http://station.local"]) {
    assertConfigError(withFields({ origins: [origin] }), "origins[0]", "https://");
  }
  for (
    const [origin, rpId] of [
      ["http://localhost:5173", "localhost"],
      ["http://app.localhost:5173", "app.localhost"],
      ["https://example.com", "example.com"],
    ]
  ) {
    assertEquals(parseStationConfig(withFields({ origins: [origin], rpId, frontURL: origin })).origins, [origin]);
  }
});

Deno.test("config: IP アドレスの origin は http でも https でも不可（RP ID は IP にできない）", () => {
  for (
    const origin of [
      "http://127.0.0.1:5173",
      "https://127.0.0.1",
      "http://[::1]:5173",
      "https://[::1]",
      "http://192.168.1.10:5173",
      "https://203.0.113.5",
    ]
  ) {
    assertConfigError(withFields({ origins: [origin] }), "origins[0]", "IP アドレス");
  }
});

Deno.test("config: rpId が IPv4 の形なら不可", () => {
  assertConfigError(withFields({ rpId: "127.0.0.1" }), "rpId", "IP アドレス");
  assertConfigError(withFields({ rpId: "192.168.1.10" }), "rpId", "IP アドレス");
});

Deno.test("config: rpId は localhost 以外ならドットを含む（公開サフィックスの一覧は持たない）", () => {
  assertConfigError(
    withFields({ origins: ["https://com"], rpId: "com", frontURL: "https://com", serverURL: "https://com" }),
    "rpId",
    "ドット",
  );
  assertConfigError(
    withFields({ origins: ["https://intranet"], rpId: "intranet", frontURL: "https://intranet" }),
    "rpId",
    "ドット",
  );
  // 公開サフィックス（2 ラベルのもの）は、ここでは通る。ブラウザが登録のときに拒む
  const config = parseStationConfig(
    withFields({ origins: ["https://github.io"], rpId: "github.io", frontURL: "https://github.io" }),
  );
  assertEquals(config.rpId, "github.io");
  assertEquals(parseStationConfig(withFields({ rpId: "localhost" })).rpId, "localhost");
});

Deno.test("config: frontURL の origin は origins に含まれる必要がある", () => {
  assertConfigError(withFields({ frontURL: "http://localhost:5174/ebina-station" }), "frontURL", "origins");
  assertConfigError(withFields({ frontURL: "https://localhost:5173/ebina-station" }), "frontURL", "origins");
  assertEquals(
    parseStationConfig(withFields({ origins: ["http://localhost:5174", "http://localhost:5173"] })).frontURL,
    "http://localhost:5173/ebina-station",
  );
});

Deno.test("config: frontURL が https のとき、serverURL の http は localhost 系だけ（混在コンテンツ）", () => {
  const https = {
    origins: ["https://example.com"],
    rpId: "example.com",
    frontURL: "https://example.com/ebina-station",
  };
  assertConfigError(withFields({ ...https, serverURL: "http://station.example.com" }), "serverURL", "https://");
  for (const serverURL of ["http://localhost:8787", "http://station.localhost:8787", "https://station.example.com"]) {
    assertEquals(parseStationConfig(withFields({ ...https, serverURL })).serverURL, serverURL);
  }
  // frontURL が http（localhost）なら serverURL の http は構わない
  assertEquals(parseStationConfig(withFields({ serverURL: "http://station.test" })).serverURL, "http://station.test");
});

Deno.test("config: rpId は origin のホスト名と合う必要がある", () => {
  assertEquals(
    parseStationConfig(
      withFields({ origins: ["https://app.example.com"], rpId: "example.com", frontURL: "https://app.example.com" }),
    ).rpId,
    "example.com",
  );
  assertEquals(
    parseStationConfig(
      withFields({ origins: ["https://example.com"], rpId: "example.com", frontURL: "https://example.com" }),
    ).rpId,
    "example.com",
  );
  assertConfigError(withFields({ origins: ["https://example.org"], rpId: "example.com" }), "rpId", "合いません");
  // 似た文字列で終わるだけのホストは通さない
  assertConfigError(withFields({ origins: ["https://evilexample.com"], rpId: "example.com" }), "rpId", "合いません");
  // 複数の origin のうち 1 つでも合わなければ誤り
  assertConfigError(
    withFields({ origins: ["https://app.example.com", "https://example.org"], rpId: "example.com" }),
    "rpId",
    "https://example.org",
  );
});

Deno.test("config: rpId の不正", () => {
  assertConfigError(withFields({ rpId: undefined }), "rpId", "ありません");
  assertConfigError(withFields({ rpId: "" }), "rpId", "空");
  assertConfigError(withFields({ rpId: 1 }), "rpId", "文字列");
  assertConfigError(withFields({ rpId: "http://localhost" }), "rpId", "ホスト名");
  assertConfigError(withFields({ rpId: "localhost:5173" }), "rpId", "ホスト名");
  assertConfigError(withFields({ rpId: "Localhost" }), "rpId", "ホスト名");
});

Deno.test("config: rpName", () => {
  assertEquals(parseStationConfig(withFields({ rpName: "  名前  " })).rpName, "名前");
  assertConfigError(withFields({ rpName: "" }), "rpName", "空");
  assertConfigError(withFields({ rpName: 1 }), "rpName", "文字列");
});

Deno.test("config: frontURL と serverURL は末尾の / を除く", () => {
  const config = parseStationConfig(
    withFields({
      origins: ["https://example.com"],
      rpId: "example.com",
      frontURL: "https://example.com/ebina-station/",
      serverURL: "https://station.example.com/",
    }),
  );
  assertEquals(config.frontURL, "https://example.com/ebina-station");
  assertEquals(config.serverURL, "https://station.example.com");
  const bare = parseStationConfig(withFields({ frontURL: "http://localhost:5173///" }));
  assertEquals(bare.frontURL, "http://localhost:5173");
});

Deno.test("config: frontURL と serverURL の不正", () => {
  for (const field of ["frontURL", "serverURL"]) {
    assertConfigError(withFields({ [field]: undefined }), field, "ありません");
    assertConfigError(withFields({ [field]: "" }), field, "空");
    assertConfigError(withFields({ [field]: 1 }), field, "文字列");
    assertConfigError(withFields({ [field]: "not a url" }), field, "URL として読めません");
    assertConfigError(withFields({ [field]: "ftp://example.com" }), field, "http");
    assertConfigError(withFields({ [field]: "https://example.com/a?x=1" }), field, "クエリ");
    assertConfigError(withFields({ [field]: "https://example.com/a#top" }), field, "#");
    assertConfigError(withFields({ [field]: "https://u:p@example.com" }), field, "ユーザー情報");
  }
});

Deno.test("config: entrance.redirect", () => {
  assertEquals(parseStationConfig(withFields({ entrance: {} })).entrance, {});
  assertEquals(parseStationConfig(withFields({ entrance: { redirect: "/a/b" } })).entrance, { redirect: "/a/b" });
  assertConfigError(withFields({ entrance: "/a" }), "entrance");
  assertConfigError(withFields({ entrance: [] }), "entrance");
  for (const redirect of [1, "a", "", "//evil.example.com", "https://evil.example.com", "/a b", "/a\nb", "/a\\b"]) {
    assertConfigError(withFields({ entrance: { redirect } }), "entrance.redirect");
  }
  assertConfigError(withFields({ entrance: { redirect: "/" } }), "entrance.redirect", "戻り続けます");
});

Deno.test("config: entrance.redirect は、正規化すると / か /index になるものも入口に戻り続けるので不可", () => {
  // Scene はクエリと # を見ずにパスで比べ、/index を / へ寄せ、. と .. と %2e を解決する
  for (
    const redirect of [
      "/index",
      "/?tab=1",
      "/#top",
      "/index?x",
      "/index#a",
      "/./index",
      "/a/..",
      "/x/../index",
      "/.",
      "/%2e",
      "/%69ndex",
    ]
  ) {
    assertConfigError(withFields({ entrance: { redirect } }), "entrance.redirect", "戻り続けます");
  }
  // 別のパスなら、クエリや # が付いても、/index に似た名前でも通る
  for (const redirect of ["/index/", "/index.bina", "/indexer", "/a/b?x=/", "/a%2fb", "/binette-editor#top"]) {
    assertEquals(parseStationConfig(withFields({ entrance: { redirect } })).entrance, { redirect }, redirect);
  }
});

Deno.test("config: loadStationConfig は読んで検査する", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "station.json");
    await Deno.writeTextFile(path, JSON.stringify({ ...valid, frontURL: "http://localhost:5173/ebina-station/" }));
    const config = await loadStationConfig(path);
    assertEquals(config.frontURL, "http://localhost:5173/ebina-station");
    assertEquals(config.rpName, "EbinaStation");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("config: loadStationConfig は無いファイルで例の場所を案内する", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "station.json");
    const e = await assertRejects(() => loadStationConfig(path), ConfigError);
    assertStringIncludes(e.message, path);
    assertStringIncludes(e.message, "examples/station.json");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("config: loadStationConfig は JSON でないファイルを ConfigError にする", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "station.json");
    await Deno.writeTextFile(path, "{ port: ");
    const e = await assertRejects(() => loadStationConfig(path), ConfigError);
    assertStringIncludes(e.message, "JSON");
    assertStringIncludes(e.message, path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("config: loadStationConfig は不正な欄を、ファイルの場所とあわせて示す", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "station.json");
    await Deno.writeTextFile(path, JSON.stringify({ ...valid, port: 0 }));
    const e = await assertRejects(() => loadStationConfig(path), ConfigError);
    assertEquals(e.field, "port");
    assertStringIncludes(e.message, path);
    assertStringIncludes(e.message, "「port」");
    assertInstanceOf(e.cause, ConfigError);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("config: loadStationConfig はフォルダなど読めないものも ConfigError にする", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const e = await assertRejects(() => loadStationConfig(dir), ConfigError);
    assertStringIncludes(e.message, dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
