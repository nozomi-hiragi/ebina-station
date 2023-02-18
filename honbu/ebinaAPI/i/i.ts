import { isBoolean, isString } from "std/encoding/_yaml/utils.ts";
import { Hono } from "hono/mod.ts";
import { authToken, JwtPayload } from "../../auth_manager/token.ts";
import { Members } from "../../project_data/members/mod.ts";
import webauthnRouter from "./webauthn/index.ts";
import { AuthenticationResponseJSON } from "../../webauthn/fido2Wrap.ts";
import { AuthManager, handleAMErrorToStatus } from "../../auth_manager/mod.ts";
import webpushRouter from "./webpush.ts";

const iRouter = new Hono();

// メンバー取得
iRouter.get("/", authToken, (c) => {
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 500);
  const member = Members.instance().getMember(payload.id);
  return c.json(member?.getValue(), 200);
});

// ログインオプション
// origin:
// :id
// 202 オプション
// 400 情報足りない
iRouter.post("/login/option", async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const body = await c.req.json<{ id: string | undefined }>();
  const id = body.id;
  try {
    return c.json(
      await AuthManager.instance().loginWebAuthnOption(origin, id),
      202,
    );
  } catch (err) {
    console.log(err);
    return c.json({}, handleAMErrorToStatus(err));
  }
});

// 認証でログイン
// { ...ret, response.serHandle }
// 200 トークン
// 400 情報足らない
// 404 メンバーない
// 500 WebAuthn設定おかしい
// 502 違うアクションを実行した？
iRouter.post("/login/verify", async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const body = await c.req.json<{
    sessionId: string | undefined;
    result?: AuthenticationResponseJSON;
  }>();
  const { sessionId, result } = body;
  if (!sessionId || !isString(sessionId) || !result) {
    return c.json({}, 400);
  }
  const id = result.response.userHandle ?? c.req.headers.get("id");
  if (!id) return c.json({}, 400);

  try {
    const token = await AuthManager.instance()
      .verifyAuthResponse(origin, id, result, sessionId);
    if (!isString(token)) return c.json({}, 502);

    return c.text(token, 200); // @TODO no json
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

// ログアウト サーバー内のトークン消す
// 200 消せた
iRouter.post("/logout", authToken, (c) => {
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  return c.json({}, 200);
});

// トークン使えるか確認
// 200 ペイロード
// 500 authToken内でペイロードとれてない
iRouter.post("/verify", authToken, (c) => {
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 500);
  return c.json(payload, 200);
});

// パスワード更新
// 200 変えれた
// 202 認証して
// 400 足らない
// 401 認証できてない
// 403 許可されてない
// 404 データない
// 422 パスワードのデータおかしい
iRouter.put("/password", authToken, async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const body = await c.req.json<
    AuthenticationResponseJSON & {
      type: string;
      current: string | undefined;
      to: string | undefined;
    }
  >();

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const ret = await am.verifyAuthResponse(origin, payload.id, body);
      return c.json({}, ret ? 200 : 422);
    } else {
      const current: string | undefined = body.current;
      const to = body.to;
      if (!current || !to) return c.json({}, 400);

      const option = await am
        .changePasswordOption(origin, payload.id, current, to);
      return c.json(option, 202);
    }
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

// パスワードリセット
// 200 変えれた
// 202 認証して
// 400 足らない
// 401 認証できてない
// 403 許可されてない
// 404 データない
// 422 パスワードのデータおかしい
iRouter.post("/password", authToken, async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const body = await c.req.json<
    AuthenticationResponseJSON & {
      type: string;
      code: string | undefined;
      to: string | undefined;
    }
  >();

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const ret = await am.verifyAuthResponse(origin, payload.id, body);
      return c.json({}, ret ? 200 : 422);
    } else {
      const code: string | undefined = body.code;
      const to: string | undefined = body.to;
      if (!code || !to) return c.json({}, 400);

      const option = await am.resetPasswordOption(origin, payload.id, code, to);
      return c.json(option, 202);
    }
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

// TOTP生成
iRouter.post("/totp/request", authToken, (c) => {
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);

  const member = Members.instance().getMember(payload.id);
  if (!member) return c.json({}, 404);
  const uri = member.generateTempTOTP();

  return c.text(uri, 200); // @TODO no json
});

// TOTP登録
iRouter.post("/totp/regist", authToken, async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const body = await c.req.json<
    AuthenticationResponseJSON & {
      type: string;
      pass: string | undefined;
      code: string | undefined;
    }
  >();

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const ret = await am.verifyAuthResponse(origin, payload.id, body);
      return c.json({}, ret ? 200 : 406);
    } else {
      const pass = body.pass;
      const code = body.code;
      if (!pass || !code) return c.json({}, 400);

      const option = await am.changeTOTP(origin, payload.id, pass, code);
      const isOption = !isBoolean(option);
      return c.json(
        isOption ? option : { result: option },
        isOption ? 202 : 200,
      );
    }
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

iRouter.route("/webauthn", webauthnRouter);
iRouter.route("/webpush", webpushRouter);

export default iRouter;
