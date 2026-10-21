import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import type { WakeServer } from "@wake-protocol/server";
import { addUser } from "../src/cli/main.ts";
import { REGISTRATION_TTL_MS } from "../src/db/registrations.ts";
import { createHttpApp } from "../src/http/app.ts";
import { b64url, type CreationOptions, SoftAuthenticator } from "./helpers/authenticator.ts";
import { captureLogs, createTestStation, TEST_ORIGIN, type TestStation } from "./helpers/station.ts";

const INVALID_TOKEN = { error: "登録トークンが無効か、期限切れです" };

function newAuthenticator(origin = TEST_ORIGIN): SoftAuthenticator {
  return new SoftAuthenticator(origin);
}

/** 登録オプションを取るところまで進める */
async function startRegistration(station: TestStation, id: string, name: string) {
  const issued = addUser({ config: station.config, db: station.db }, id, name);
  const res = await station.json("/register/options", { body: { token: issued.token, code: issued.code } });
  assertEquals(res.status, 200);
  return { issued, options: res.body as CreationOptions };
}

async function rawRequest(station: TestStation, path: string, init: RequestInit): Promise<Response> {
  return await station.fetch(`http://station.test${path}`, init);
}

Deno.test("http: 知らないパスは 404 {error: 見つかりません}", async () => {
  await using station = await createTestStation();
  for (const path of ["/", "/ebina", "/ebina/nothing", "/ebina/auth/nothing", "/ebina/wake/nothing", "/station/apps"]) {
    const res = await rawRequest(station, path, {});
    assertEquals(res.status, 404, path);
    assertEquals(await res.json(), { error: "見つかりません" }, path);
  }
});

Deno.test("http: CORS は origins だけを許し、Content-Type と Retry-After を公開する", async () => {
  await using station = await createTestStation({
    config: { origins: [TEST_ORIGIN, "http://localhost:5174"] },
  });

  // プリフライト
  for (const origin of [TEST_ORIGIN, "http://localhost:5174"]) {
    const res = await rawRequest(station, "/ebina/register/options", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assertEquals(res.status, 204);
    assertEquals(res.headers.get("access-control-allow-origin"), origin);
    assertEquals(res.headers.get("access-control-allow-methods"), "GET,POST,OPTIONS");
    assertEquals(res.headers.get("access-control-allow-headers"), "Content-Type");
  }

  const denied = await rawRequest(station, "/ebina/register/options", {
    method: "OPTIONS",
    headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" },
  });
  assertEquals(denied.headers.get("access-control-allow-origin"), null);

  // 通常のリクエスト（WAKE を通る応答にも付く）
  const res = await rawRequest(station, "/ebina/register/info?token=x", { headers: { Origin: TEST_ORIGIN } });
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("access-control-allow-origin"), TEST_ORIGIN);
  assertEquals(res.headers.get("access-control-expose-headers"), "Content-Type,Retry-After");
  await res.body?.cancel();

  const wakeRes = await rawRequest(station, "/ebina/auth/start", {
    method: "POST",
    headers: { Origin: TEST_ORIGIN, "Content-Type": "application/json" },
    body: "{}",
  });
  assertEquals(wakeRes.headers.get("access-control-allow-origin"), TEST_ORIGIN);
  await wakeRes.body?.cancel();

  const other = await rawRequest(station, "/ebina/register/info?token=x", {
    headers: { Origin: "http://evil.example" },
  });
  assertEquals(other.headers.get("access-control-allow-origin"), null);
  await other.body?.cancel();
});

Deno.test("http: WAKE が扱わないパスは 404、例外は 500 で内容を返さない", async () => {
  await using station = await createTestStation();
  const logs = captureLogs();
  try {
    // handle() が null を返す → 404
    const noneWake: WakeServer = { ...station.wake, handle: () => Promise.resolve(null) };
    const none = createHttpApp({ ...station, wake: noneWake });
    const notFound = await none.request("/ebina/auth/anything");
    assertEquals(notFound.status, 404);
    assertEquals(await notFound.json(), { error: "見つかりません" });

    // handle() が例外 → 500（メッセージは応答に出さない。ログには出す）
    const brokenWake: WakeServer = { ...station.wake, handle: () => Promise.reject(new Error("secret-detail")) };
    const broken = createHttpApp({ ...station, wake: brokenWake });
    const res = await broken.request("/ebina/wake/transport", { method: "POST" });
    assertEquals(res.status, 500);
    assertEquals(await res.json(), { error: "サーバーエラーです" });
    assert(logs.lines.some((l) => l.includes("ERROR") && l.includes("secret-detail")));
  } finally {
    logs.restore();
  }
});

Deno.test("http: ログは METHOD パス ステータスだけで、クエリ（登録トークン）を出さない", async () => {
  await using station = await createTestStation();
  const logs = captureLogs();
  try {
    const issued = addUser({ config: station.config, db: station.db }, "alice", "Alice");
    const res = await station.json(`/register/info?token=${issued.token}`);
    assertEquals(res.status, 200);
    const line = logs.lines.find((l) => l.includes("/ebina/register/info"));
    assert(line !== undefined);
    assertStringIncludes(line, "GET /ebina/register/info 200");
    for (const l of logs.lines) assert(!l.includes(issued.token), "ログに登録トークンが出ている");
  } finally {
    logs.restore();
  }
});

Deno.test("http register: JSON が不正なら 400", async () => {
  await using station = await createTestStation();
  for (const path of ["/register/options", "/register/verify"]) {
    for (const body of ["not json", "[]", "null", "42", ""]) {
      const res = await rawRequest(station, `/ebina${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      assertEquals(res.status, 400, `${path} ${JSON.stringify(body)}`);
      assertEquals(await res.json(), { error: "JSON が正しくありません" });
    }
  }
});

Deno.test("http register: 大きすぎる本文は 413", async () => {
  await using station = await createTestStation();
  const res = await rawRequest(station, "/ebina/register/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "x".repeat(100_000), code: "0000" }),
  });
  assertEquals(res.status, 413);
  assertEquals(await res.json(), { error: "リクエストが大きすぎます" });
});

Deno.test("http register: 知らないトークンは info / options / verify のどれも 404", async () => {
  await using station = await createTestStation();
  assertEquals(await station.json("/register/info?token=nope"), { status: 404, body: INVALID_TOKEN });
  assertEquals(await station.json("/register/info"), { status: 404, body: INVALID_TOKEN });
  assertEquals(await station.json("/register/options", { body: { token: "nope", code: "0000" } }), {
    status: 404,
    body: INVALID_TOKEN,
  });
  assertEquals(await station.json("/register/options", { body: {} }), { status: 404, body: INVALID_TOKEN });
  assertEquals(await station.json("/register/verify", { body: { token: "nope", response: {} } }), {
    status: 404,
    body: INVALID_TOKEN,
  });
});

Deno.test("http register: 期限（15 分）が切れたトークンは使えない", async () => {
  const clock = { now: 1_700_000_000_000 };
  await using station = await createTestStation({ now: () => clock.now });
  const issued = addUser({ config: station.config, db: station.db, now: () => clock.now }, "alice", "Alice");
  assertEquals((await station.json(`/register/info?token=${issued.token}`)).status, 200);
  clock.now += REGISTRATION_TTL_MS - 1;
  assertEquals((await station.json(`/register/info?token=${issued.token}`)).status, 200);
  clock.now += 1;
  assertEquals(await station.json(`/register/info?token=${issued.token}`), { status: 404, body: INVALID_TOKEN });
  assertEquals(await station.json("/register/options", { body: { token: issued.token, code: issued.code } }), {
    status: 404,
    body: INVALID_TOKEN,
  });
});

Deno.test("http register: options の前の verify は 400、形の不正な応答も 400", async () => {
  await using station = await createTestStation();
  const issued = addUser({ config: station.config, db: station.db }, "alice", "Alice");
  assertEquals(await station.json("/register/verify", { body: { token: issued.token, response: {} } }), {
    status: 400,
    body: { error: "先に登録を開始してください" },
  });

  await station.json("/register/options", { body: { token: issued.token, code: issued.code } });
  for (const response of [undefined, null, "x", [], {}, { id: "a", rawId: "a" }, { id: "a", rawId: "a", type: "x" }]) {
    assertEquals(await station.json("/register/verify", { body: { token: issued.token, response } }), {
      status: 400,
      body: { error: "登録情報が不正です" },
    }, JSON.stringify(response));
  }
});

Deno.test("http register: 公開鍵の欠落・不一致、challenge や origin の違いは 400。検証に進んだ失敗は challenge を捨てる", async () => {
  await using station = await createTestStation();
  const { issued, options } = await startRegistration(station, "alice", "Alice");
  const auth = newAuthenticator();
  const response = await auth.register(options);
  const verify = (resp: unknown) => station.json("/register/verify", { body: { token: issued.token, response: resp } });
  // 検証に失敗すると challenge は捨てられるので、やり直しは options からもう一度
  const restart = async () =>
    (await station.json("/register/options", { body: { token: issued.token, code: issued.code } }))
      .body as CreationOptions;
  const notStarted = { status: 400, body: { error: "先に登録を開始してください" } };

  // publicKey が無い（検証の前に断るので、challenge は残る）
  const { publicKey: _omit, ...withoutKey } = response.response;
  assertEquals(await verify({ ...response, response: withoutKey }), {
    status: 400,
    body: { error: "公開鍵が見つかりません" },
  });

  // publicKey が別の鍵（検証済みの COSE と一致しない）
  const other = await newAuthenticator().register(options);
  assertEquals(await verify({ ...response, response: { ...response.response, publicKey: other.response.publicKey } }), {
    status: 400,
    body: { error: "公開鍵が一致しません" },
  });
  // 同じ challenge の応答はもう受け付けない
  assertEquals(await verify(response), notStarted);

  // 登録オプションの challenge と違う
  const stale = await newAuthenticator().register({ ...(await restart()), challenge: b64url(new Uint8Array(32)) });
  assertEquals(await verify(stale), { status: 400, body: { error: "パスキーを検証できませんでした" } });
  assertEquals(await verify(stale), notStarted);

  // origin が違う
  const wrongOrigin = await newAuthenticator("http://evil.example").register(await restart());
  assertEquals(await verify(wrongOrigin), { status: 400, body: { error: "パスキーを検証できませんでした" } });

  // RP ID が違う
  const wrongRp = await newAuthenticator().register({ ...(await restart()), rp: { ...options.rp, id: "example.com" } });
  assertEquals(await verify(wrongRp), { status: 400, body: { error: "パスキーを検証できませんでした" } });

  // 失敗してもトークンは使われない。options からやり直した正しい応答なら通る
  assertEquals(station.credentials.listByUser("alice").length, 0);
  assertEquals(await verify(await auth.register(await restart())), { status: 200, body: { ok: true } });
  assertEquals(station.credentials.listByUser("alice").length, 1);
});

Deno.test("http register: 検証の失敗ログに challenge は出ず、ログから拾った challenge では登録できない", async () => {
  await using station = await createTestStation();
  const logs = captureLogs();
  try {
    const { issued, options } = await startRegistration(station, "alice", "Alice");
    const verify = (response: unknown) => station.json("/register/verify", { body: { token: issued.token, response } });

    // 登録 URL だけを知る側が、別の challenge で作った応答を送る
    const forged = await newAuthenticator().register({ ...options, challenge: b64url(new Uint8Array(32)) });
    assertEquals(await verify(forged), { status: 400, body: { error: "パスキーを検証できませんでした" } });
    const text = logs.lines.join("\n");
    assertStringIncludes(text, "パスキーの検証に失敗しました");
    assertStringIncludes(text, "(challenge)");
    assertFalse(text.includes(options.challenge), "保存してある challenge がログに出ている");

    // 仮にログから challenge を知られても、それでは完了できない
    const attack = await newAuthenticator().register(options);
    assertEquals(await verify(attack), { status: 400, body: { error: "先に登録を開始してください" } });
    assertEquals(station.credentials.listByUser("alice").length, 0);
  } finally {
    logs.restore();
  }
});

Deno.test("http register: 保存済みと同じ credentialId は 409。別のユーザーのパスキーを上書きできない", async () => {
  await using station = await createTestStation();
  const first = await startRegistration(station, "alice", "Alice");
  const authA = newAuthenticator();
  const respA = await authA.register(first.options);
  assertEquals(
    (await station.json("/register/verify", { body: { token: first.issued.token, response: respA } })).status,
    200,
  );
  const before = station.credentials.listByUser("alice");

  const second = await startRegistration(station, "bob", "Bob");
  const respB = await newAuthenticator().register(second.options, { credentialId: authA.credentials[0].id });
  assertEquals(await station.json("/register/verify", { body: { token: second.issued.token, response: respB } }), {
    status: 409,
    body: { error: "このパスキーはすでに登録されています" },
  });
  assertEquals(station.credentials.listByUser("alice"), before);
  assertEquals(station.credentials.listByUser("bob").length, 0);
  // 409 のときは検証までで止まり、トークンは使われていない
  assertEquals((await station.json(`/register/info?token=${second.issued.token}`)).status, 200);
});

Deno.test("http register: 同じトークンの verify を同時に送っても、登録されるのは 1 つ", async () => {
  await using station = await createTestStation();
  const { issued, options } = await startRegistration(station, "alice", "Alice");
  const responses = await Promise.all(
    [newAuthenticator(), newAuthenticator(), newAuthenticator()].map((a) => a.register(options)),
  );
  const results = await Promise.all(
    responses.map((response) => station.json("/register/verify", { body: { token: issued.token, response } })),
  );
  assertEquals(results.filter((r) => r.status === 200).length, 1);
  assertEquals(results.filter((r) => r.status === 404).length, 2);
  assertEquals(station.credentials.listByUser("alice").length, 1);
});

Deno.test("http register: トランスポートは既知のものだけ保存する", async () => {
  await using station = await createTestStation();
  const { issued, options } = await startRegistration(station, "alice", "Alice");
  const response = await newAuthenticator().register(options);
  const sent = { ...response, response: { ...response.response, transports: ["usb", "evil", 5, "hybrid"] } };
  assertEquals((await station.json("/register/verify", { body: { token: issued.token, response: sent } })).status, 200);
  assertEquals(station.credentials.listByUser("alice")[0].transports, ["usb", "hybrid"]);
});
