import { assert, assertEquals } from "@std/assert";
import type { EtAuth, EtHandlerRequest, EtHandlerResponse, WakeCredential } from "@wake-protocol/server";
import { createEtHandler, type EtTarget, resolveEtTarget } from "../src/et/handler.ts";
import { etError, etJson } from "../src/et/respond.ts";
import { b64url, fromB64url } from "./helpers/authenticator.ts";
import { captureLogs, createFakeHub, createTestStation, fakeApp, type TestStation } from "./helpers/station.ts";

const decoder = new TextDecoder();

function bodyOf(res: EtHandlerResponse): unknown {
  return JSON.parse(decoder.decode(res.body ?? new Uint8Array()));
}

Deno.test("respond: etJson / etError は content-type と UTF-8 の JSON 本文を持つ", () => {
  const res = etJson(201, { a: "日本語" });
  assertEquals(res.status, 201);
  assertEquals(res.headers, [["content-type", "application/json"]]);
  assertEquals(bodyOf(res), { a: "日本語" });

  const err = etError(404, "not_found");
  assertEquals(err.status, 404);
  assertEquals(bodyOf(err), { error: { code: "not_found" } });
});

const NOT_FOUND: EtTarget = { kind: "error", status: 404, code: "not_found" };
const INVALID: EtTarget = { kind: "error", status: 400, code: "invalid_url" };
const app = (name: string, path: string): EtTarget => ({ kind: "app", name, path });

Deno.test("resolveEtTarget: Station 自身とアプリへの振り分け", () => {
  const table: [string, EtTarget][] = [
    ["wake://station/me", { kind: "me" }],
    ["wake://station/me?x=1", { kind: "me" }],
    ["wake://station/index.bina", { kind: "entrance" }],
    ["wake://station/index.bina?x=1", { kind: "entrance" }],

    ["wake://station/echo", app("echo", "/")],
    ["wake://station/echo/", app("echo", "/")],
    ["wake://station/echo?x=1", app("echo", "/?x=1")],
    ["wake://station/echo/?x=1", app("echo", "/?x=1")],
    ["wake://station/echo/hello", app("echo", "/hello")],
    ["wake://station/echo/hello?x=1&y=%2F", app("echo", "/hello?x=1&y=%2F")],
    ["wake://station/echo/a/b/c.txt", app("echo", "/a/b/c.txt")],
    ["wake://station/echo/a/", app("echo", "/a/")],
    ["wake://station/echo/a%20b", app("echo", "/a%20b")],
    ["wake://station/echo/%E3%81%82", app("echo", "/%E3%81%82")],
    ["wake://station/echo/index.bina", app("echo", "/index.bina")],
    ["wake://station/echo.bina", app("echo", "/index.bina")],
    ["wake://station/echo.bina?x=1", app("echo", "/index.bina?x=1")],
    ["wake://station/my-app2", app("my-app2", "/")],
    ["wake://station/a?b?c", app("a", "/?b?c")],

    // 404: 予約名、規則に合わない名前、形が違うもの
    ["wake://station/station", NOT_FOUND],
    ["wake://station/station/apps", NOT_FOUND],
    ["wake://station/settings", NOT_FOUND],
    ["wake://station/settings.bina", NOT_FOUND],
    ["wake://station/settings/x", NOT_FOUND],
    ["wake://station/ebina", NOT_FOUND],
    ["wake://station/ebina/auth/start", NOT_FOUND],
    ["wake://station/index", NOT_FOUND],
    ["wake://station/index/x", NOT_FOUND],
    ["wake://station/index.bina/x", NOT_FOUND],
    ["wake://station/me/x", NOT_FOUND],
    ["wake://station/me.bina", NOT_FOUND],
    ["wake://station/Echo", NOT_FOUND],
    ["wake://station/1app", NOT_FOUND],
    ["wake://station/-app", NOT_FOUND],
    ["wake://station/a_b", NOT_FOUND],
    ["wake://station/echo.bina/x", NOT_FOUND],
    ["wake://station/echo.txt", NOT_FOUND],
    ["wake://station/.bina", NOT_FOUND],
    ["wake://station/", NOT_FOUND],
    ["wake://station/?x=1", NOT_FOUND],
    ["wake://station", NOT_FOUND],
    ["wake://other/echo", NOT_FOUND],
    ["wake://station:80/echo", NOT_FOUND],
    ["WAKE://station/echo", NOT_FOUND],
    ["http://station/echo", NOT_FOUND],
    ["/echo", NOT_FOUND],
    ["echo", NOT_FOUND],
    ["", NOT_FOUND],

    // 400: . .. 空の区間 %2f %5c
    ["wake://station/.", INVALID],
    ["wake://station/..", INVALID],
    ["wake://station/echo/.", INVALID],
    ["wake://station/echo/..", INVALID],
    ["wake://station/echo/../x", INVALID],
    ["wake://station/echo/./x", INVALID],
    ["wake://station/echo/%2e", INVALID],
    ["wake://station/echo/%2E%2e/x", INVALID],
    ["wake://station/echo/.%2E", INVALID],
    ["wake://station/echo//", INVALID],
    ["wake://station/echo//x", INVALID],
    ["wake://station//echo", INVALID],
    ["wake://station/echo/a//b", INVALID],
    ["wake://station/echo/a%2fb", INVALID],
    ["wake://station/echo/a%2Fb", INVALID],
    ["wake://station/echo/a%5cb", INVALID],
    ["wake://station/echo/a%5Cb", INVALID],
    ["wake://station/echo%2Fx", INVALID],
    ["wake://station/echo/a\\b", INVALID],
    ["wake://station/echo/..\\x", INVALID],
    ["wake://station/echo/%00", INVALID],
    ["wake://station/echo/%1f", INVALID],
    ["wake://station/echo/%7f", INVALID],
    ["wake://station/echo/%", INVALID],
    ["wake://station/echo/%zz", INVALID],
    ["wake://station/echo/%ff", INVALID],
    // 400 は予約名の 404 より先に決まる
    ["wake://station/station/../x", INVALID],
    ["wake://station/settings//x", INVALID],
  ];
  for (const [url, expected] of table) {
    assertEquals(resolveEtTarget(url), expected, JSON.stringify(url));
  }
});

Deno.test("resolveEtTarget: クエリの中の %2f や .. は検査しない（アプリにそのまま渡す）", () => {
  assertEquals(resolveEtTarget("wake://station/echo?next=%2Fa/../b"), app("echo", "/?next=%2Fa/../b"));
  assertEquals(resolveEtTarget("wake://station/echo/x?p=a%5Cb"), app("echo", "/x?p=a%5Cb"));
});

const SESSION: Omit<EtAuth, "userId" | "credentialId"> = { sessionId: "s", epoch: 0, authTime: 0, requestId: "r" };

function request(url: string, method = "GET", body = new Uint8Array()): EtHandlerRequest {
  return { method, url, headers: [], body };
}

/** ユーザーと、そのユーザーの active なパスキーを DB に入れ、ET に渡す auth を返す */
function addAuth(
  station: TestStation,
  userId: string,
  status: WakeCredential["status"] = "active",
): EtAuth {
  if (!station.users.get(userId)) station.users.create(userId, userId.toUpperCase());
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  station.credentials.add({
    credentialId,
    userId,
    userHandle: new TextEncoder().encode(userId),
    publicKey: crypto.getRandomValues(new Uint8Array(91)),
    algorithm: -7,
    signCount: 0,
    backupEligible: false,
    status,
  });
  return { ...SESSION, userId, credentialId: b64url(credentialId) };
}

Deno.test("handler: ユーザーかパスキーが無い、active でない、別のユーザーのものなら 401", async () => {
  const hub = createFakeHub({ apps: [fakeApp("echo")] });
  await using station = await createTestStation({ hub });
  const handler = createEtHandler({ ...station, hub });
  const good = addAuth(station, "alice");
  const suspended = addAuth(station, "carol", "suspended");
  const deleted = addAuth(station, "dave", "deleted");
  const bobsCredential = addAuth(station, "bob").credentialId;

  assertEquals((await handler(request("wake://station/me"), good)).status, 200);

  const unauthorized = [
    // ユーザーがいない
    { ...good, userId: "ghost" },
    // パスキーがいない（ID が合わない、base64url として不正、空）
    { ...good, credentialId: b64url(crypto.getRandomValues(new Uint8Array(16))) },
    { ...good, credentialId: "!!" },
    { ...good, credentialId: "" },
    // active でない
    suspended,
    deleted,
    // 別のユーザーのパスキー
    { ...good, credentialId: bobsCredential },
  ];
  for (const auth of unauthorized) {
    for (const url of ["wake://station/me", "wake://station/index.bina", "wake://station/echo", "wake://station/x"]) {
      const res = await handler(request(url), auth);
      assertEquals(res.status, 401, `${JSON.stringify(auth)} ${url}`);
      assertEquals(bodyOf(res), { error: { code: "unauthorized" } });
      assert((res.headers ?? []).some(([name, value]) => name === "ebina-station-error" && value === "unauthorized"));
    }
  }
  // 401 のときは URL の検査より先に決まり、アプリにも届かない
  assertEquals((await handler(request("wake://station/echo/../x"), { ...good, userId: "ghost" })).status, 401);
  assertEquals(hub.calls.length, 0);

  // パスキーを消すと、それまで通っていた auth が 401 になる
  assert(station.credentials.remove(fromB64url(good.credentialId)));
  assertEquals((await handler(request("wake://station/me"), good)).status, 401);
});

Deno.test("handler: me と入口は GET だけ", async () => {
  await using station = await createTestStation();
  const handler = createEtHandler({ ...station });
  const auth = addAuth(station, "alice");

  const me = await handler(request("wake://station/me"), auth);
  assertEquals(me.status, 200);
  assertEquals(me.headers, [["content-type", "application/json"]]);
  assertEquals(bodyOf(me), { id: "alice", name: "ALICE" });

  const entrance = await handler(request("wake://station/index.bina"), auth);
  assertEquals(entrance.status, 200);
  assertEquals((bodyOf(entrance) as { binette: string }).binette, "0.1");

  for (const url of ["wake://station/me", "wake://station/index.bina"]) {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await handler(request(url, method), auth);
      assertEquals(res.status, 405, `${method} ${url}`);
      assertEquals(bodyOf(res), { error: { code: "method_not_allowed" } });
      assert(
        (res.headers ?? []).some(([name, value]) => name === "allow" && value === "GET, HEAD"),
        `${method} ${url}`,
      );
    }
    // HEAD は GET と同じステータスとヘッダーで、本文は空
    const get = await handler(request(url, "GET"), auth);
    const head = await handler(request(url, "HEAD"), auth);
    assertEquals(head.status, get.status);
    assertEquals(head.headers, get.headers);
    assertEquals(head.body?.byteLength, 0);
  }
});

Deno.test("handler: 有効で存在するアプリだけを中継し、hub の応答をそのまま返す", async () => {
  const response: EtHandlerResponse = { status: 418, headers: [["x-a", "b"]], body: new Uint8Array([1, 2, 3]) };
  const hub = createFakeHub({
    apps: [fakeApp("echo"), fakeApp("off", { enabled: false }), fakeApp("broken", { status: "error", error: "x" })],
    respond: () => response,
  });
  await using station = await createTestStation({ hub });
  const handler = createEtHandler({ ...station, hub });
  const auth = addAuth(station, "alice");

  // 中継する（停止中・異常でも、状態の判断は hub に任せる）
  const req: EtHandlerRequest = {
    method: "PUT",
    url: "wake://station/echo/a/b?k=v",
    headers: [["X-A", "1"]],
    body: new Uint8Array([9]),
  };
  assertEquals(await handler(req, auth), response);
  assertEquals(hub.calls.length, 1);
  assertEquals(hub.calls[0].name, "echo");
  assertEquals(hub.calls[0].path, "/a/b?k=v");
  assertEquals(hub.calls[0].req, req);
  assertEquals(hub.calls[0].userId, "alice");

  assertEquals((await handler(request("wake://station/broken"), auth)).status, 418);
  assertEquals(hub.calls.length, 2);

  // 無効、無い、予約名は 404 で、hub の relay は呼ばれない
  for (
    const url of ["wake://station/off", "wake://station/off.bina", "wake://station/nothere", "wake://station/station"]
  ) {
    const res = await handler(request(url), auth);
    assertEquals(res.status, 404, url);
    assertEquals(bodyOf(res), { error: { code: "not_found" } });
  }
  assertEquals(hub.calls.length, 2);
});

Deno.test("handler: 最初の走査が済むまでは、アプリと入口が 503 app_unavailable", async () => {
  const hub = createFakeHub({ apps: [fakeApp("echo")] });
  hub.isScanned = false;
  await using station = await createTestStation({ hub });
  const handler = createEtHandler({ ...station, hub });
  const auth = addAuth(station, "alice");

  for (
    const url of ["wake://station/echo", "wake://station/echo/a", "wake://station/nothere", "wake://station/index.bina"]
  ) {
    const res = await handler(request(url), auth);
    assertEquals(res.status, 503, url);
    assertEquals(bodyOf(res), { error: { code: "app_unavailable" } });
  }
  assertEquals(hub.calls.length, 0);
  // アプリを経由しない me は走査を待たない
  assertEquals((await handler(request("wake://station/me"), auth)).status, 200);

  hub.isScanned = true;
  assertEquals((await handler(request("wake://station/echo"), auth)).status, 200);
  assertEquals((await handler(request("wake://station/index.bina"), auth)).status, 200);
  assertEquals((await handler(request("wake://station/nothere"), auth)).status, 404);
});

Deno.test("handler: relay が例外を投げたら 500 internal（内容は返さず、ログに残す）", async () => {
  const hub = createFakeHub({
    apps: [fakeApp("echo")],
    respond: () => {
      throw new Error("boom-detail");
    },
  });
  await using station = await createTestStation({ hub });
  const handler = createEtHandler({ ...station, hub });
  const auth = addAuth(station, "alice");
  const logs = captureLogs();
  try {
    const res = await handler(request("wake://station/echo"), auth);
    assertEquals(res.status, 500);
    assertEquals(bodyOf(res), { error: { code: "internal" } });
    assert(!decoder.decode(res.body).includes("boom-detail"));
    assert(logs.lines.some((l) => l.includes("echo") && l.includes("boom-detail")));
  } finally {
    logs.restore();
  }
});

Deno.test("handler: 入口は hub の今のアプリ一覧から作る", async () => {
  const hub = createFakeHub({ apps: [fakeApp("a")] });
  await using station = await createTestStation({ hub });
  const handler = createEtHandler({ ...station, hub });
  const auth = addAuth(station, "alice");
  const names = async () => {
    const main = (bodyOf(await handler(request("wake://station/index.bina"), auth)) as {
      assets: { main: { content: string } };
    }).assets.main.content;
    return [...main.matchAll(/"name":"([^"]+)"/g)].map((m) => m[1]);
  };
  assertEquals(await names(), ["a"]);
  hub.apps = [fakeApp("a"), fakeApp("b")];
  assertEquals(await names(), ["a", "b"]);
});
