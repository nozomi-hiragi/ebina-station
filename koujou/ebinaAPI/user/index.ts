import { bcrypt, oak } from "../../deps.ts";
import {
  authToken,
  generateTokens,
  refreshTokens,
  removeToken,
} from "../../utils/auth.ts";
import { addMember, getMember, User } from "../../data/members.ts";
import { logApi } from "../../utils/log.ts";
import { getMembers, removeMember } from "../../data/members.ts";
import webauthnRouter from "./webauthn.ts";

const userRouter = new oak.Router();

// funcs
const createUser = (name: string, pass: string) => {
  const passwordAuth = { hash: bcrypt.hashSync(pass) };
  const user: User = { name, auth: { password: passwordAuth } };
  return user;
};

const registUser = (id: string, name: string, pass: string) => {
  if (getMember(id)) return false;
  const user = createUser(name, pass);
  return addMember(id, user);
};

const getMembersArray = (ids: string[]) => {
  const members = getMembers();
  const memberIds = Object.keys(members);
  return memberIds
    .filter((id) => ids.length !== 0 ? ids.includes(id) : true)
    .map((id) => ({ ...members[id], id, auth: undefined }));
};

// メンバー作成
// { id, name, pass }
// 201 できた
// 400 情報足らない
// 406 IDがもうある˝
userRouter.post("/", async (ctx) => {
  const { id, name, pass } = await ctx
    .request.body({ type: "json" }).value;
  if (!id || !name || !pass) return ctx.response.status = 400;

  if (registUser(id, name, pass)) {
    ctx.response.status = 201;
  } else {
    logApi.info("user/regest", "already have this id", id);
    ctx.response.status = 406;
  }
});

// メンバー配列取得 ID無いなら全部
// ?ids
// 200 空でも返す
userRouter.get("/", authToken, (ctx) => {
  ctx.response.body = getMembersArray(
    ctx.request.url.searchParams.get("ids")?.split(",") ?? [],
  );
});

// メンバー配列削除
// ?ids
// 200 全部できた
// 206 一部できた
// 404 全部できない
userRouter.delete("/", authToken, (ctx) => {
  const payload = ctx.state.payload;
  const ids = ctx.request.url.searchParams.get("ids")?.split(",") ?? [];

  const failedIds: string[] = [];
  ids.forEach((id) => {
    if (id === payload?.id) return;
    if (!removeMember(id)) failedIds.push(id);
  });
  if (failedIds.length === ids.length) {
    ctx.response.status = 404;
  } else if (failedIds.length === 0) {
    ctx.response.status = 200;
  } else {
    ctx.response.status = 206;
    ctx.response.body = { failedIDs: failedIds };
  }
});

// メンバー取得
// :id
// 200 メンバー
// 400 IDない
// 404 みつからない
userRouter.get("/:id", authToken, (ctx) => {
  const { id } = ctx.params;
  if (!id) return ctx.response.status = 400;

  const member = getMember(id);
  if (member) {
    ctx.response.body = { ...member, auth: undefined };
  } else {
    ctx.response.status = 404;
  }
});

// パスワードでログイン
// { id, pass }
// 200 ユーザーとトークン
// 400 情報足らない
// 401 パスワードが違う
// 404 メンバーない
// 405 パスワードが設定されてない
userRouter.post("/login", async (ctx) => {
  const { id, pass }: { id: string; pass: string } = await ctx.request.body({
    type: "json",
  }).value;
  if (!id || !pass) return ctx.response.status = 400;

  const user = getMember(id);
  if (user === undefined) {
    logApi.info("post", "user/login", "not exist user", id);
    return ctx.response.status = 404;
  }

  const passwordAuth = user.auth.password;
  if (!passwordAuth || !passwordAuth.hash) return ctx.response.status = 405;

  if (bcrypt.compareSync(pass, passwordAuth.hash)) {
    const tokens = await generateTokens(id);
    ctx.response.body = { user: { ...user, auth: undefined }, tokens };
  } else {
    ctx.response.status = 401;
  }
});

// ログアウト サーバー内のトークン消す
// 200 消せた
// 401 無かった
userRouter.post("/logout", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  ctx.response.status = removeToken(payload.id) ? 200 : 401;
});

// トークン更新
// { refreshToken }
// 200 新トークン
// 400 リフレッシュトークンない
// 401 リフレッシュトークンおかしい
userRouter.post("/refresh", async (ctx) => {
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
userRouter.post("/verify", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 500;
  ctx.response.body = payload;
});

userRouter.use("/webauthn", webauthnRouter.routes());

export default userRouter;
