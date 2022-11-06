import { oak } from "../../deps.ts";
import { iURL } from "../ebina.ts";
import webauthnRouter from "./webauthn/index.ts";

const iRouter = new oak.Router();

// ログインオプション
// origin:
// :id
// 202 オプション
// 400 情報足りない
iRouter.post("/login/option", async (ctx) => {
  await fetch(`${iURL}/login/option`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// 認証でログイン
// { ...ret, response.serHandle }
// 200 ユーザーとトークン
// 400 情報足らない
// 404 メンバーない
// 500 WebAuthn設定おかしい
iRouter.post("/login/verify", async (ctx) => {
  await fetch(`${iURL}/login/verify`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
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
  await fetch(`${iURL}/login`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// ログアウト サーバー内のトークン消す
// 200 消せた
// 401 無かった
iRouter.post("/logout", async (ctx) => {
  await fetch(`${iURL}/logout`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.text();
    ctx.response.status = ret.status;
  });
});

// トークン更新申請
// { refreshToken }
// 202 passかwebauthnか
// 400 情報不足
// 401 トークンおかしい
// 404 いない
iRouter.post("/refresh/option", async (ctx) => {
  await fetch(`${iURL}/refresh/option`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// トークン更新
// { refreshToken, result?, pass? }
// 200 トークン
// 400 情報不足
// 401 認証おかしい
// 404 いない
iRouter.post("/refresh/verify", async (ctx) => {
  await fetch(`${iURL}/refresh/verify`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// トークン使えるか確認
// 200 ペイロード
// 500 authToken内でペイロードとれてない
iRouter.post("/verify", async (ctx) => {
  await fetch(`${iURL}/verify`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// パスワード更新
// 200 変えれた
// 202 認証して
// 400 足らない
// 401 認証できてない
// 403 許可されてない
// 404 データない
// 405 パスワードのデータおかしい
iRouter.put("/password", async (ctx) => {
  await fetch(`${iURL}/password`, {
    method: "PUT",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

iRouter.use("/webauthn", webauthnRouter.routes());

export default iRouter;
