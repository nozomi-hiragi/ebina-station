import { oak } from "../../../deps.ts";
import {
  authToken,
  generateTokens,
  refreshTokens,
  removeToken,
} from "../../../utils/auth.ts";
import { logApi } from "../../../utils/log.ts";
import { getMembers } from "../../../settings/members/members.ts";
import { Member } from "../../../settings/members/member.ts";
import {
  createLoginOptions,
  verifyLoginChallenge,
} from "../../../utils/webauthn/funcs.ts";
import { HttpExeption } from "../../../utils/utils.ts";
import webauthnRouter from "./webauthn/index.ts";

const iRouter = new oak.Router();

// プレログイン
// origin:
// :id
// 200 オプション
// 400 情報足りない
// 500 WebAuthnの設定おかしい
iRouter.get("/login/:id", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  const { id } = ctx.params;
  if (!origin || !id) return ctx.response.status = 400;

  const member = getMembers().getMember(id);
  if (!member) {
    console.log("unknown member id");
    return ctx.response.body = { type: "password" };
  }

  try {
    const options = await createLoginOptions(origin, member, []);
    ctx.response.body = { type: "WebAuthn", options };
  } catch (err) {
    if (!(err instanceof HttpExeption)) throw err;

    switch (err.status) {
      case 404:
      case 406:
        return ctx.response.body = { type: "password" };
      default:
        ctx.response.status = err.status;
        ctx.response.body = err.message;
    }
  }
});

// パスワードでログイン
// { type, id, pass }
// 200 ユーザーとトークン
// 400 情報足らない
// 401 パスワードが違う
// 404 メンバーない
// 405 パスワードが設定されてない
iRouter.post("/login", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const hostname = new URL(origin).hostname;
  const body = await ctx.request.body({ type: "json" }).value;

  let member: Member | undefined;
  switch (body.type as string) {
    default:
      return ctx.response.status = 400;

    case "public-key": {
      const id = body.response.userHandle;
      member = getMembers().getMember(id);
      if (!member) return ctx.response.status = 404;
      try {
        await verifyLoginChallenge(origin, member, body);
      } catch (err) {
        if (err instanceof HttpExeption) {
          ctx.response.status = err.status;
          ctx.response.body = err.message;
        } else {
          throw err;
        }
        return;
      }
      break;
    }

    case "password": {
      const id = body.id;
      const pass: string = body.pass;
      if (!id || !pass) return ctx.response.status = 400;
      member = getMembers().getMember(id);
      if (!member) {
        logApi.info(["post", "member/login", "not exist member", id]);
        return ctx.response.status = 404;
      }
      if (member.hasWebAuthn(hostname)) {
        logApi.info(["post", "member/login", "you have webauthn", id]);
        return ctx.response.status = 400;
      }
      switch (member.authMemberWithPassword(pass)) {
        case true:
          break;
        case false:
          return ctx.response.status = 401;
        case undefined:
          return ctx.response.status = 405;
      }
      break;
    }
  }

  const tokens = await generateTokens(member.getId());
  ctx.response.body = { member: member.getValue(), tokens };
});

// ログアウト サーバー内のトークン消す
// 200 消せた
// 401 無かった
iRouter.post("/logout", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  ctx.response.status = removeToken(payload.id) ? 200 : 401;
});

// トークン更新
// { refreshToken }
// 200 新トークン
// 400 リフレッシュトークンない
// 401 リフレッシュトークンおかしい
iRouter.post("/refresh", async (ctx) => {
  const { refreshToken } = await ctx.request.body({ type: "json" }).value;
  if (!refreshToken) return ctx.response.status = 400;

  const tokens = await refreshTokens(refreshToken);
  if (tokens) {
    ctx.response.body = tokens;
  } else {
    ctx.response.status = 401;
  }
});

// トークン使えるか確認
// 200 ペイロード
// 500 authToken内でペイロードとれてない
iRouter.post("/verify", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 500;
  ctx.response.body = payload;
});

iRouter.use("/webauthn", webauthnRouter.routes());

export default iRouter;
