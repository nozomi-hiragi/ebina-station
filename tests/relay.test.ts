import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import {
  buildChildHeaders,
  filterResponseHeaders,
  isRelayPath,
  RELAY_BODY_MAX,
  relayToChild,
  toEtResponse,
} from "../src/apps/relay.ts";
import { setLogSink } from "../src/log.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

// 502 にした理由の警告でテストの出力を汚さない（中身を調べるテストは collectLogs を使う）
const quiet = () => {};
setLogSink(quiet);

/** fn の間に出たログの行を集める */
async function collectLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  setLogSink((line) => lines.push(line));
  try {
    await fn();
  } finally {
    setLogSink(quiet);
  }
  return lines;
}

function text(body: Uint8Array | undefined): string {
  return decoder.decode(body ?? new Uint8Array(0));
}

Deno.test("relay: アプリへ渡すヘッダー（除くもの）", () => {
  const headers = buildChildHeaders(
    [
      ["Connection", "keep-alive, X-Named"],
      ["Keep-Alive", "timeout=5"],
      ["Proxy-Authenticate", "Basic"],
      ["Proxy-Authorization", "Basic abc"],
      ["TE", "trailers"],
      ["Trailer", "Expires"],
      ["Transfer-Encoding", "chunked"],
      ["Upgrade", "websocket"],
      ["Host", "evil.example"],
      ["Content-Length", "999"],
      ["Accept-Encoding", "zstd"],
      ["X-Named", "connection に名前がある"],
      ["Ebina-User", "evil"],
      ["EBINA-APP-TOKEN", "forged"],
      ["eBiNa-Anything", "1"],
      ["Content-Type", "text/plain"],
      ["X-Test", "1"],
    ],
    "alice",
    "real-token",
  );
  assertEquals(
    [...headers.keys()].sort(),
    ["content-type", "ebina-app-token", "ebina-user", "x-test"],
  );
  assertEquals(headers.get("ebina-user"), "alice");
  assertEquals(headers.get("ebina-app-token"), "real-token");
  assertEquals(headers.get("x-test"), "1");
  assertEquals(headers.get("content-type"), "text/plain");
});

Deno.test("relay: 同じ名前のヘッダーは並びを保って渡す", () => {
  const headers = buildChildHeaders([["X-A", "1"], ["x-a", "2"], ["Accept", "a"]], "bob", "t");
  assertEquals(headers.get("x-a"), "1, 2");
  assertEquals(headers.get("accept"), "a");
});

Deno.test("relay: 応答のヘッダー（除くもの・規則）", () => {
  const headers = new Headers([
    ["Content-Type", "application/json"],
    ["X-Visible", "yes"],
    ["Set-Cookie", "a=b"],
    ["Set-Cookie", "c=d"],
    ["Content-Length", "10"],
    ["Content-Encoding", "gzip"],
    ["Connection", "close"],
    ["Keep-Alive", "timeout=5"],
    ["Transfer-Encoding", "chunked"],
    ["Upgrade", "h2c"],
    ["Proxy-Authenticate", "Basic"],
    ["TE", "trailers"],
    ["Trailer", "Expires"],
    ["Ebina-Secret", "1"],
    ["EBINA-X", "2"],
  ]);
  assertEquals(filterResponseHeaders(headers), [["content-type", "application/json"], ["x-visible", "yes"]]);
});

Deno.test("relay: 応答のヘッダーが ET の規則に合わなければ null", () => {
  // 制御文字（Headers は許すが、ET は許さない）
  assertEquals(filterResponseHeaders(new Headers({ "X-A": "a\x01b" })), null);
  assertEquals(filterResponseHeaders(new Headers({ "X-A": "tab\tok~" })), [["x-a", "tab\tok~"]]);

  // 名前と値の長さの合計が 8 KiB まで
  const name = "x-big";
  assertEquals(filterResponseHeaders(new Headers({ [name]: "a".repeat(8192 - name.length) })) !== null, true);
  assertEquals(filterResponseHeaders(new Headers({ [name]: "a".repeat(8193 - name.length) })), null);
  assertEquals(
    filterResponseHeaders(new Headers([["x-a", "a".repeat(4096)], ["x-b", "b".repeat(4096)]])),
    null,
  );
});

Deno.test("relay: 中継するパス", () => {
  for (const path of ["/", "/a", "/a/b.bina?x=1", "/files/hello.txt", "/%E3%81%82", "//a", "/a?b=c&d=e"]) {
    assert(isRelayPath(path), path);
  }
  for (const path of ["", "a", "?x=1", "@evil.example/", "/a b", "/a#b", "/a\\b", "/日本語", "/a\n", "/a\u0000"]) {
    assertFalse(isRelayPath(path), JSON.stringify(path));
  }
});

Deno.test("relay: Response を ET の応答にする", async () => {
  const ok = await toEtResponse(
    new Response("こんにちは", { status: 201, headers: { "Content-Type": "text/plain; charset=utf-8", "X-A": "1" } }),
  );
  assertEquals(ok.status, 201);
  assertEquals(ok.headers, [["content-type", "text/plain; charset=utf-8"], ["x-a", "1"]]);
  assertEquals(text(ok.body), "こんにちは");

  const empty = await toEtResponse(new Response(null, { status: 204 }));
  assertEquals(empty.status, 204);
  assertEquals(empty.body?.byteLength, 0);

  assertEquals((await toEtResponse(new Response("", { status: 599 }))).status, 599);
  assertEquals((await toEtResponse(new Response("", { status: 302, headers: { Location: "/x" } }))).status, 302);
});

Deno.test("relay: ステータスが 200〜599 でなければ 502", async () => {
  for (const status of [101, 199, 600]) {
    const response = new Response("x");
    Object.defineProperty(response, "status", { value: status });
    const result = await toEtResponse(response);
    assertEquals(result.status, 502, String(status));
    assertEquals(text(result.body), '{"error":{"code":"bad_gateway"}}');
  }
});

Deno.test("relay: 本文は上限まで。超えたら 502", async () => {
  assertEquals((await toEtResponse(new Response("a".repeat(10)), 10)).status, 200);
  assertEquals((await toEtResponse(new Response("a".repeat(11)), 10)).status, 502);

  // content-length を持たない（ストリームの）応答でも、読みながら数えて止める
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(4));
      if (pulls >= 1000) controller.close();
    },
  });
  assertEquals((await toEtResponse(new Response(stream), 10)).status, 502);
  assert(pulls < 10, `読みすぎ: ${pulls}`);

  assertEquals(RELAY_BODY_MAX, 1024 * 1024);
});

Deno.test("relay: ヘッダーが規則に合わない応答は 502", async () => {
  const response = new Response("x", { headers: { "X-A": "a\x01" } });
  assertEquals((await toEtResponse(response)).status, 502);
});

Deno.test("relay: アプリの 401 はそのまま返し、Station の印（ebina-station-error）は偽れない", async () => {
  const result = await toEtResponse(
    Response.json({ error: { code: "unauthorized" } }, {
      status: 401,
      headers: { "Ebina-Station-Error": "unauthorized", "WWW-Authenticate": "Bearer" },
    }),
    100,
    "foo",
  );
  assertEquals(result.status, 401);
  assertEquals(text(result.body), '{"error":{"code":"unauthorized"}}');
  const names = (result.headers ?? []).map(([name]) => name);
  assertFalse(names.includes("ebina-station-error"), names.join(","));
  assert(names.includes("www-authenticate"), names.join(","));
});

Deno.test("relay: 子プロセスからの中継でもアプリの 401 はそのまま返し、印は除く", async () => {
  const respond = () =>
    Response.json({ error: { code: "unauthorized" } }, {
      status: 401,
      headers: { "Ebina-Station-Error": "unauthorized" },
    });
  await withServer(respond, async (port) => {
    const result = await relayToChild(
      { name: "guard", port, token: "TOKEN-VALUE" },
      "/api",
      etRequest("GET", []),
      "alice",
    );
    assertEquals(result.status, 401);
    assertFalse((result.headers ?? []).some(([name]) => name === "ebina-station-error"));
  });
});

Deno.test("relay: 502 にした理由をログに出す（ステータス・ヘッダー・本文）", async () => {
  const bad = new Response("x");
  Object.defineProperty(bad, "status", { value: 600 });
  const lines = await collectLogs(async () => {
    assertEquals((await toEtResponse(bad, 100, "foo")).status, 502);
    assertEquals(
      (await toEtResponse(new Response("x", { headers: { "X-A": "SECRET-A\x01" } }), 100, "foo")).status,
      502,
    );
    assertEquals(
      (await toEtResponse(new Response("x", { headers: { "X-Long": "L".repeat(9000) } }), 100, "foo")).status,
      502,
    );
    assertEquals((await toEtResponse(new Response("a".repeat(101)), 100, "foo")).status, 502);
    // content-length を持たない応答が、読みながら上限を超える
    assertEquals(
      (await toEtResponse(
        new Response(new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(new Uint8Array(101)), c.close()) })),
        100,
        "foo",
      )).status,
      502,
    );
    assertEquals((await toEtResponse(new Response("ok"), 100, "foo")).status, 200);
  });
  assertEquals(lines.length, 5, lines.join("\n"));
  for (const line of lines) {
    assertStringIncludes(line, "WARN");
    assertStringIncludes(line, "アプリ foo の応答を 502 にしました");
    assertFalse(line.includes("SECRET-A"), line);
  }
  assertStringIncludes(lines[0], "600");
  assertStringIncludes(lines[1], "ヘッダー");
  assertStringIncludes(lines[2], "8 KiB");
  assertStringIncludes(lines[3], "100 バイト");
  assertStringIncludes(lines[4], "100 バイト");
});

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 受けたリクエストを JSON で返す、テスト用のアプリ。respond で応答を差し替えられる */
async function withServer(
  respond: ((req: Request) => Response | Promise<Response>) | undefined,
  fn: (port: number) => Promise<void>,
): Promise<void> {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
    if (respond) return await respond(req);
    const seen: Seen = {
      method: req.method,
      url: new URL(req.url).pathname + new URL(req.url).search,
      headers: Object.fromEntries(req.headers),
      body: await req.text(),
    };
    return Response.json(seen);
  });
  try {
    await fn(server.addr.port);
  } finally {
    await server.shutdown();
  }
}

function etRequest(method: string, headers: [string, string][] = [], body = ""): {
  method: string;
  url: string;
  headers: [string, string][];
  body: Uint8Array;
} {
  return { method, url: "wake://station/app/x", headers, body: encoder.encode(body) };
}

Deno.test("relay: メソッド・パス・クエリ・本文・ヘッダーをアプリへ渡す", async () => {
  await withServer(undefined, async (port) => {
    const target = { name: "app", port, token: "secret-token" };
    const result = await relayToChild(
      target,
      "/a/b?x=1&y=%E3%81%82",
      etRequest("POST", [["Ebina-User", "evil"], ["X-Test", "1"], ["Content-Type", "text/plain"]], "abc"),
      "alice",
    );
    assertEquals(result.status, 200);
    const seen: Seen = JSON.parse(text(result.body));
    assertEquals(seen.method, "POST");
    assertEquals(seen.url, "/a/b?x=1&y=%E3%81%82");
    assertEquals(seen.body, "abc");
    assertEquals(seen.headers["ebina-user"], "alice");
    assertEquals(seen.headers["ebina-app-token"], "secret-token");
    assertEquals(seen.headers["x-test"], "1");
    assertEquals(seen.headers["content-type"], "text/plain");
    assertEquals(seen.headers.host, `127.0.0.1:${port}`);
  });
});

Deno.test("relay: GET と HEAD は本文を付けない", async () => {
  await withServer(undefined, async (port) => {
    const target = { name: "app", port, token: "t" };
    const get = await relayToChild(target, "/", etRequest("GET", [], "付けない"), "alice");
    const seen: Seen = JSON.parse(text(get.body));
    assertEquals(seen.body, "");
    assertEquals(seen.headers["content-length"], undefined);

    const head = await relayToChild(target, "/", etRequest("HEAD", [], "付けない"), "alice");
    assertEquals(head.status, 200);
    assertEquals(head.body?.byteLength, 0);
  });
});

Deno.test("relay: 応答のステータス・ヘッダー・本文を返し、除くヘッダーは落とす", async () => {
  const respond = () =>
    new Response("本文", {
      status: 418,
      headers: [
        ["Content-Type", "text/plain; charset=utf-8"],
        ["Set-Cookie", "session=secret"],
        ["Ebina-Secret", "1"],
        ["X-Visible", "yes"],
      ],
    });
  await withServer(respond, async (port) => {
    const result = await relayToChild({ name: "app", port, token: "t" }, "/", etRequest("GET"), "alice");
    assertEquals(result.status, 418);
    const names = (result.headers ?? []).map(([name]) => name);
    assert(names.includes("content-type"));
    assert(names.includes("x-visible"));
    for (const dropped of ["set-cookie", "ebina-secret", "content-length", "transfer-encoding"]) {
      assertFalse(names.includes(dropped), dropped);
    }
    assertEquals(text(result.body), "本文");
  });
});

Deno.test("relay: 圧縮された応答は伸ばして返し、content-encoding は付けない", async () => {
  const respond = () => {
    const body = new Response("圧縮されるテキスト".repeat(20)).body!.pipeThrough(new CompressionStream("gzip"));
    return new Response(body, { headers: { "Content-Encoding": "gzip", "Content-Type": "text/plain; charset=utf-8" } });
  };
  await withServer(respond, async (port) => {
    const result = await relayToChild({ name: "app", port, token: "t" }, "/", etRequest("GET"), "alice");
    assertEquals(result.status, 200);
    assertEquals(text(result.body), "圧縮されるテキスト".repeat(20));
    assertFalse((result.headers ?? []).some(([name]) => name === "content-encoding"));
  });
});

Deno.test("relay: リダイレクトは辿らずそのまま返す", async () => {
  const respond = () => new Response(null, { status: 302, headers: { Location: "/elsewhere" } });
  await withServer(respond, async (port) => {
    const result = await relayToChild({ name: "app", port, token: "t" }, "/", etRequest("GET"), "alice");
    assertEquals(result.status, 302);
    assertEquals(result.headers?.find(([name]) => name === "location")?.[1], "/elsewhere");
  });
});

Deno.test("relay: 本文が上限を超えたら 502", async () => {
  const respond = () => new Response(new Uint8Array(100).fill(97));
  await withServer(respond, async (port) => {
    const target = { name: "app", port, token: "t" };
    assertEquals((await relayToChild(target, "/", etRequest("GET"), "alice", { bodyMax: 100 })).status, 200);
    const over = await relayToChild(target, "/", etRequest("GET"), "alice", { bodyMax: 99 });
    assertEquals(over.status, 502);
    assertEquals(text(over.body), '{"error":{"code":"bad_gateway"}}');
  });
});

Deno.test("relay: つながらない・時間切れ・途中で止まる応答は 502 で、ログに秘密を出さない", async () => {
  const lines: string[] = [];
  setLogSink((line) => lines.push(line));
  try {
    // 閉じたポート
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const closedPort = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const refused = await relayToChild(
      { name: "app", port: closedPort, token: "TOKEN-VALUE" },
      "/?secret=QUERY-VALUE",
      etRequest("GET"),
      "alice",
    );
    assertEquals(refused.status, 502);

    // 応答を返さない（クライアントが切るまで待つ）
    const hang = (req: Request) =>
      new Promise<Response>((resolve) => req.signal.addEventListener("abort", () => resolve(new Response("切れた"))));
    await withServer(hang, async (port) => {
      const timedOut = await relayToChild(
        { name: "app", port, token: "TOKEN-VALUE" },
        "/?secret=QUERY-VALUE",
        etRequest("GET"),
        "alice",
        { timeoutMs: 100 },
      );
      assertEquals(timedOut.status, 502);
    });

    // ヘッダーのあと、本文が止まる
    const stall = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("途中"));
          },
        }),
      );
    await withServer(stall, async (port) => {
      const stalled = await relayToChild({ name: "app", port, token: "t" }, "/", etRequest("GET"), "alice", {
        timeoutMs: 100,
      });
      assertEquals(stalled.status, 502);
    });
  } finally {
    setLogSink(quiet);
  }
  assert(lines.length >= 2, lines.join("\n"));
  for (const line of lines) {
    assertStringIncludes(line, "WARN");
    assertFalse(line.includes("TOKEN-VALUE"), line);
    assertFalse(line.includes("QUERY-VALUE"), line);
  }
});

Deno.test("relay: 応答の connection に名前が挙がったヘッダーも除く", () => {
  const headers = new Headers({
    "Connection": "X-Internal, Keep-Alive",
    "X-Internal": "secret",
    "Keep-Alive": "timeout=5",
    "X-Visible": "yes",
  });
  assertEquals(filterResponseHeaders(headers), [["x-visible", "yes"]]);
});
