import { bcrypt, oak } from "../../deps.ts";
import {
  authToken,
  generateTokens,
  refreshTokens,
  removeToken,
} from "../../utils/auth.ts";
import { logApi } from "../../utils/log.ts";
import {
  addMember,
  getMember,
  getMembers,
  removeMember,
} from "../../project_data/members/members.ts";
import { Member } from "../../project_data/members/member.ts";
import webauthnRouter from "./webauthn/index.ts";
import {
  createLoginOptions,
  verifyLoginChallenge,
} from "../../utils/webauthn/funcs.ts";
import { HttpExeption } from "../../utils/utils.ts";

const userRouter = new oak.Router();

// funcs
const createUser = (name: string, pass: string) => {
  const passwordAuth = { hash: bcrypt.hashSync(pass) };
  const member: Member = { name, auth: { password: passwordAuth } };
  return member;
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

// プレログイン
// origin:
// :id
// 200 オプション
// 400 情報足りない
// 500 WebAuthnの設定おかしい
userRouter.get("/login/:id", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const { id } = ctx.params;
  if (!id) return ctx.response.status = 400;

  const member = getMember(id);
  if (!member) {
    return ctx.response.body = { type: "password" };
  }

  try {
    const options = await createLoginOptions(origin, id, []);
    ctx.response.body = {
      type: "WebAuthn",
      options,
    };
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
userRouter.post("/login", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const body = await ctx.request.body({ type: "json" }).value;
  let member: Member | undefined;
  let id: string;
  switch (body.type as string) {
    default:
      return ctx.response.status = 400;

    case "public-key": {
      id = body.response.userHandle;
      try {
        await verifyLoginChallenge(origin, id, body);
        member = getMember(id);
      } catch (err) {
        if (err instanceof HttpExeption) {
          ctx.response.status = err.status;
          ctx.response.body = err.message;
        } else {
          throw err;
        }
      }
      break;
    }

    case "password": {
      id = body.id;
      const pass: string = body.pass;
      if (!id || !pass) return ctx.response.status = 400;
      member = getMember(id);
      if (member === undefined) {
        logApi.info(["post", "user/login", "not exist user", id]);
        return ctx.response.status = 404;
      }
      if (member.auth.webAuthn && member.auth.webAuthn[origin]) {
        logApi.info(["post", "user/login", "you have webauthn", id]);
        return ctx.response.status = 400;
      }
      const passwordAuth = member.auth.password;
      if (!passwordAuth || !passwordAuth.hash) return ctx.response.status = 405;

      if (bcrypt.compareSync(pass, passwordAuth.hash)) {
        const tokens = await generateTokens(id);
        ctx.response.body = { user: { ...member, auth: undefined }, tokens };
      } else {
        ctx.response.status = 401;
      }
      break;
    }
  }

  const tokens = await generateTokens(id);
  ctx.response.body = { user: { ...member, auth: undefined }, tokens };
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
