import { isString, oak } from "../../deps.ts";
import {
  authToken,
  generateTokens,
  isJwtToken,
  refreshTokens,
  removeToken,
  verifyRefreshToken,
} from "../../utils/auth.ts";
import { logApi } from "../../utils/log.ts";
import { Members } from "../../project_data/members/mod.ts";
import {
  createOptionsForAuth,
  verifyChallengeForAuth,
} from "../../auth_manager/webauthn.ts";
import { HttpExeption, randomString } from "../../utils/utils.ts";
import webauthnRouter from "./webauthn/index.ts";
import {
  createPasswordAuth,
  isPasswordAuth,
} from "../../project_data/members/auth/password.ts";
import { Settings } from "../../project_data/settings/mod.ts";

const iRouter = new oak.Router();

// ログインオプション
// origin:
// :id
// 202 オプション
// 400 情報足りない
iRouter.post("/login/option", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const body = await ctx.request.body({ type: "json" }).value;
  const id: string = body.id;
  const members = Members.instance();

  try {
    let member = undefined;
    if (id) {
      member = members.getMember(id);
      if (!member) {
        const allMemberCount = members.allMemberCount();
        if (Settings.instance().Member.canRegistNewMember(allMemberCount)) {
          const token = randomString(32);
          members.setPreRequest(id, ctx.request.ip, token);
          ctx.response.status = 202;
          ctx.response.body = { type: "Regist", token };
          return;
        }
        console.log("unknown member id");
        throw new HttpExeption(404, "no member");
      }
    }
    const sessionId = randomString(16);
    const options = await createOptionsForAuth(
      origin,
      sessionId,
      async (member) => await generateTokens(member.getId()),
      member,
    );
    ctx.response.status = 202;
    ctx.response.body = { type: "WebAuthn", options, sessionId };
  } catch (err) {
    if (!(err instanceof HttpExeption)) throw err;
    switch (err.status) {
      case 404:
      case 406:
      case 500:
        ctx.response.status = 202;
        ctx.response.body = { type: "Password" };
        break;
      default:
        ctx.response.status = err.status;
        ctx.response.body = err.message;
    }
  }
});

// 認証でログイン
// { ...ret, response.serHandle }
// 200 ユーザーとトークン
// 400 情報足らない
// 404 メンバーない
// 500 WebAuthn設定おかしい
iRouter.post("/login/verify", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const body = await ctx.request.body({ type: "json" }).value;
  const { sessionId, result } = body;
  if (!sessionId || !result) return ctx.response.status = 400;

  const id = result.response.userHandle;
  const member = Members.instance().getMember(id);
  if (!member) return ctx.response.status = 404;
  try {
    const ret = await verifyChallengeForAuth(origin, member, result, sessionId);
    if (!ret.actionResult) throw new Error("Verify failed");
    if (!isJwtToken(ret.actionResult)) throw new Error("Recieve wrong result");
    const tokens = ret.actionResult;
    ctx.response.body = { member: { ...member.getValue(), id }, tokens };
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
      return;
    } else throw err;
  }
});

// パスワードでログイン
// { type, id, pass }
// 200 ユーザーとトークン
// 400 情報足らない
// 401 パスワードが違う
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
  const member = Members.instance().getMember(id);
  if (!member) {
    logApi.info(["post", "member/login", "not exist member", id]);
    return ctx.response.status = 404;
  }
  if (member.hasWebAuthn(hostname)) {
    logApi.info(["post", "member/login", "you have webauthn", id]);
    return ctx.response.status = 406;
  }
  switch (member.authMemberWithPassword(pass)) {
    case true:
      break;
    case false:
      return ctx.response.status = 401;
    case undefined:
      return ctx.response.status = 405;
  }
  const tokens = await generateTokens(member.getId());
  ctx.response.body = { member: { ...member.getValue(), id: id }, tokens };
});

// ログアウト サーバー内のトークン消す
// 200 消せた
// 401 無かった
iRouter.post("/logout", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  ctx.response.status = removeToken(payload.id) ? 200 : 401;
});

// トークン更新申請
// { refreshToken }
// 202 passかwebauthnか
// 400 情報不足
// 401 トークンおかしい
// 404 いない
iRouter.post("/refresh/option", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const { refreshToken } = await ctx.request.body({ type: "json" }).value;
  if (!refreshToken || !isString(refreshToken)) {
    return ctx.response.status = 400;
  }
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) return ctx.response.status = 401;
  const { id } = payload;
  const members = Members.instance();
  const member = members.getMember(id);
  if (!member) return ctx.response.status = 404;

  try {
    const options = await createOptionsForAuth(
      origin,
      refreshToken,
      async () => await refreshTokens(refreshToken),
      member,
    );
    ctx.response.status = 202;
    ctx.response.body = { type: "WebAuthn", options };
  } catch (err) {
    if (!(err instanceof HttpExeption)) throw err;
    switch (err.status) {
      case 406:
      case 500:
        ctx.response.status = 202;
        ctx.response.body = { type: "Password" };
        break;
      default:
        ctx.response.status = err.status;
        ctx.response.body = err.message;
    }
  }
});

// トークン更新
// { refreshToken, result?, pass? }
// 200 トークン
// 400 情報不足
// 401 認証おかしい
// 404 いない
iRouter.post("/refresh/verify", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const body = await ctx.request.body({ type: "json" }).value;
  const { refreshToken, result, pass } = body;
  if (!refreshToken || !isString(refreshToken)) {
    return ctx.response.status = 400;
  }
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) return ctx.response.status = 401;
  const { id } = payload;
  const members = Members.instance();
  const member = members.getMember(id);
  if (!member) return ctx.response.status = 404;

  if (result) {
    try {
      const ret = await verifyChallengeForAuth(
        origin,
        member,
        result,
        refreshToken,
      );
      if (!ret.actionResult) return ctx.response.status = 401;
      if (!isJwtToken(ret.actionResult)) return ctx.response.status = 400;
      const tokens = ret.actionResult;
      ctx.response.status = 200;
      ctx.response.body = tokens;
      return;
    } catch (err) {
      if (err instanceof HttpExeption) {
        ctx.response.status = err.status;
        ctx.response.body = err.message;
        return;
      } else throw err;
    }
  } else if (pass && isString(pass)) {
    switch (member.authMemberWithPassword(pass)) {
      case true:
        break;
      case false:
        return ctx.response.status = 401;
      case undefined:
        return ctx.response.status = 405;
    }
    const tokens = await refreshTokens(refreshToken);
    if (tokens) {
      ctx.response.status = 200;
      ctx.response.body = tokens;
      return;
    } else {
      return ctx.response.status = 401;
    }
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

// パスワード更新
// 200 変えれた
// 202 認証して
// 400 足らない
// 401 認証できてない
// 403 許可されてない
// 404 データない
// 405 パスワードのデータおかしい
iRouter.put("/password", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const members = Members.instance();
  const member = members.getMember(payload.id);
  if (!member) return ctx.response.status = 404;

  const body = await ctx.request.body({ type: "json" }).value;
  if (body.type === "public-key") {
    try {
      const ret = await verifyChallengeForAuth(
        origin,
        member,
        body,
        payload.id,
      );
      if (!ret.actionResult) throw new Error("No action registed");
      if (!isPasswordAuth(ret.actionResult)) {
        throw new Error("Recieve wrong action result");
      }
      member.setPassword(ret.actionResult);
      members.setMember(member);
      return ctx.response.status = 200;
    } catch {
      return ctx.response.status = 401;
    }
  } else {
    const current: string | undefined = body.current;
    const _new: string | undefined = body.new;
    if (!current || !_new) return ctx.response.status = 400;
    try {
      if (!ctx.request.secure && ctx.request.url.hostname !== "localhost") {
        throw new Error("no secure");
      }

      const action = member.authMemberWithPassword(current)
        ? () => Promise.resolve(createPasswordAuth(_new))
        : undefined;
      const options = await createOptionsForAuth(
        origin,
        payload.id,
        action,
        member,
      );
      ctx.response.body = options;

      return ctx.response.status = 202;
    } catch (err) {
      if (err instanceof HttpExeption || err.message === "no secure") {
        switch (member.updatePassword(current, _new)) {
          case true:
            Members.instance().setMember(member);
            return ctx.response.status = 200;
          case false:
            return ctx.response.status = 401;
          case undefined:
            return ctx.response.status = 405;
        }
      } else {
        return ctx.response.status = 403;
      }
    }
  }
});

iRouter.use("/webauthn", webauthnRouter.routes());

export default iRouter;
