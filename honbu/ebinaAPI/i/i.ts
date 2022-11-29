import { oak, TypeUtils } from "../../deps.ts";
import { authToken } from "../../auth_manager/token.ts";
import { Members } from "../../project_data/members/mod.ts";
import webauthnRouter from "./webauthn/index.ts";
import { AuthManager, handleAMErrorToStatus } from "../../auth_manager/mod.ts";
import webpushRouter from "./webpush.ts";

const iRouter = new oak.Router();

// メンバー取得
iRouter.get("/", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 500;
  const member = Members.instance().getMember(payload.id);
  ctx.response.body = member?.getValue();
  ctx.response.status = 200;
});

// ログインオプション
// origin:
// :id
// 202 オプション
// 400 情報足りない
iRouter.post("/login/option", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const body = await ctx.request.body({ type: "json" }).value;
  const id: string | undefined = body.id;
  try {
    ctx.response.body = await AuthManager.instance()
      .loginWebAuthnOption(origin, id);
    ctx.response.status = 202;
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
  }
});

// 認証でログイン
// { ...ret, response.serHandle }
// 200 トークン
// 400 情報足らない
// 404 メンバーない
// 500 WebAuthn設定おかしい
// 502 違うアクションを実行した？
iRouter.post("/login/verify", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const body = await ctx.request.body({ type: "json" }).value;
  const { sessionId, result } = body;
  if (!sessionId || !TypeUtils.isString(sessionId) || !result) {
    return ctx.response.status = 400;
  }
  const id = result.response.userHandle;

  try {
    const token = await AuthManager.instance()
      .verifyAuthResponse(origin, id, result, sessionId);
    if (!TypeUtils.isString(token)) return ctx.response.status = 502;

    ctx.response.body = token;
    ctx.response.status = 200;
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
  }
});

// パスワードでログイン
// { type, id, pass }
// 200 トークン
// 400 情報足らない
// 403 パスワードが違う
// 404 メンバーない
// 405 パスワードが設定されてない
// 406 パスワードはだめ
iRouter.post("/login", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const hostname = new URL(origin).hostname;
  const body = await ctx.request.body({ type: "json" }).value;

  const id: string = body.id;
  const pass: string = body.pass;
  if (!id || !pass) return ctx.response.status = 400;

  try {
    const token = await AuthManager.instance()
      .loginWithPassword(hostname, id, pass);

    ctx.response.body = token;
    ctx.response.status = 200;
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
  }
});

// ログアウト サーバー内のトークン消す
// 200 消せた
iRouter.post("/logout", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  ctx.response.status = 200;
});

// トークン使えるか確認
// 200 ペイロード
// 500 authToken内でペイロードとれてない
iRouter.post("/verify", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 500;
  ctx.response.body = payload;
  ctx.response.status = 200;
});

// パスワード更新
// 200 変えれた
// 202 認証して
// 400 足らない
// 401 認証できてない
// 403 許可されてない
// 404 データない
// 422 パスワードのデータおかしい
iRouter.put("/password", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const body = await ctx.request.body({ type: "json" }).value;

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const ret = await am.verifyAuthResponse(origin, payload.id, body);
      return ctx.response.status = ret ? 200 : 422;
    } else {
      const current: string | undefined = body.current;
      const to: string | undefined = body.new;
      if (!current || !to) return ctx.response.status = 400;

      const option = await am
        .changePasswordOption(origin, payload.id, current, to);
      ctx.response.body = option;
      ctx.response.status = 202;
    }
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
  }
});

iRouter.use("/webauthn", webauthnRouter.routes());
iRouter.use("/webpush", webpushRouter.routes());

export default iRouter;
