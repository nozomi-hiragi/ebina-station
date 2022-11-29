import { isString, oak } from "../../deps.ts";
import { authToken, JwtPayload } from "../../auth_manager/token.ts";
import { Members } from "../../project_data/members/mod.ts";
import { AuthManager, hadleAMErrorToStatus } from "../../auth_manager/mod.ts";

const memberRouter = new oak.Router();

// ユーザー登録リクエスト
// { front, server, id, name }
// 20
// 400 パラメ足らん
// 409 メンバー上限
// 500 URLエラー
memberRouter.post("/regist/request", authToken, async (ctx) => {
  const payload: JwtPayload = ctx.state.payload!;
  let { front, server, id, name } = await ctx.request
    .body({ type: "json" }).value;

  if (!server) server = `${ctx.request.url.protocol}//${ctx.request.url.host}`;
  if (!isString(server)) return ctx.response.status = 400;

  if (!front) {
    const origin = ctx.request.headers.get("origin");
    if (!origin) return ctx.response.status = 400;
    front = `${origin}/ebina-station`;
  }
  if (!isString(front)) return ctx.response.status = 400;

  const token = AuthManager.instance().getRegistNewMemeberToken(payload.id);
  if (!token) return ctx.response.status = 409;

  let url: string | undefined = undefined;
  try {
    const registURL = new URL(`${front}/regist`);
    registURL.searchParams.set("t", token);
    registURL.searchParams.set("s", server);
    if (id && isString(id)) registURL.searchParams.set("i", id);
    if (name && isString(name)) registURL.searchParams.set("n", name);
    url = registURL.toString();
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
  }
  ctx.response.status = 201;
  ctx.response.body = { token, url };
});

// 仮登録
// { id, name, pass }
// 201 オプションあげる
// 400 パラメ足らん
// 409 メンバ競合
memberRouter.post("/regist/option", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const { id, name, pass, token } = await ctx.request
    .body({ type: "json" }).value;
  if (!id || !name || !pass || !token) return ctx.response.status = 400;

  try {
    const option = await AuthManager.instance()
      .registTempMemberOption(origin, token, id, name, pass);
    ctx.response.body = option;
    ctx.response.status = 201;
  } catch (err) {
    return ctx.response.status = hadleAMErrorToStatus(err);
  }
});

// 仮登録認証
// { id, name, pass }
// 200 できた
// 400 パラメ足らん
// 401 トークン違う
// 404 いない
memberRouter.post("/regist/verify", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const body = await ctx.request.body({ type: "json" }).value;
  const { id, result } = body;
  if (!id || !isString(id) || !result) return ctx.response.status = 400;

  try {
    await AuthManager.instance().registTempMemberVerify(origin, id, result);
    ctx.response.status = 200;
  } catch (err) {
    return ctx.response.status = hadleAMErrorToStatus(err);
  }
});

// メンバー配列取得 ID無いなら全部
// ?ids
// 200 空でも返す
memberRouter.get("/", authToken, (ctx) => {
  const ids = ctx.request.url.searchParams.get("ids")?.split(",") ?? [];

  ctx.response.body = Members.instance().getMembersArray(ids);
});

// メンバー配列削除
// ?ids
// 200 全部できた
// 206 一部できた
// 404 全部できない
memberRouter.delete("/", authToken, (ctx) => {
  const payload = ctx.state.payload;
  const ids = ctx.request.url.searchParams.get("ids")?.split(",") ?? [];

  const failedIds: string[] = [];
  ids.forEach((id) => {
    if (id === payload?.id) return;
    if (!Members.instance().removeMember(id)) failedIds.push(id);
  });
  if (failedIds.length === ids.length) {
    ctx.response.status = 404;
  } else if (failedIds.length !== 0) {
    ctx.response.status = 206;
    ctx.response.body = { failedIDs: failedIds };
  } else {
    ctx.response.status = 200;
  }
});

// メンバー取得
// :id
// 200 メンバー
// 400 IDない
// 404 みつからない
memberRouter.get("/member/:id", authToken, (ctx) => {
  const { id } = ctx.params;
  if (!id) return ctx.response.status = 400;

  const member = Members.instance().getMember(id);
  if (member) {
    ctx.response.body = { ...member, auth: undefined };
  } else {
    ctx.response.status = 404;
  }
});

// 仮メンバーたち
// 200 ok
memberRouter.get("/temp", authToken, (ctx) => {
  const members = Members.instance().getTempMembers();
  const arrangedMembers = Object.keys(members).map((id) => {
    const member = members[id]!;
    return { id, from: member.from, member: member.member.getValue() };
  });

  ctx.response.status = 200;
  ctx.response.body = arrangedMembers;
});

// 仮メンバー承認
// 200 ok
// 202 認証して
// 400 足らない
// 401 認証できてない
memberRouter.post("/temp/admit", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const body = await ctx.request.body({ type: "json" }).value;

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const successIds = await am.verifyAuthResponse(origin, payload.id, body);
      ctx.response.body = successIds;
      ctx.response.status = 200;
    } else {
      const ids = body.ids;
      if (!ids || !Array.isArray(ids)) return ctx.response.status = 400;

      const option = await am.createAuthOption(origin, payload.id, {
        id: payload.id,
        action: () => {
          const successIds = ids
            .filter((id) => Members.instance().admitTempMember(id));
          return Promise.resolve(successIds);
        },
      });
      ctx.response.body = option;
      ctx.response.status = 202;
    }
  } catch (err) {
    return ctx.response.status = hadleAMErrorToStatus(err);
  }
});

// 仮メンバー否認
// 200 ok
// 202 認証して
// 400 足らない
// 401 認証できてない
memberRouter.post("/temp/deny", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const body = await ctx.request.body({ type: "json" }).value;

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const failedIds = await am.verifyAuthResponse(origin, payload.id, body);
      ctx.response.body = failedIds;
      ctx.response.status = 200;
    } else {
      const ids = body.ids;
      if (!ids || !Array.isArray(ids)) return ctx.response.status = 400;

      const option = await am.createAuthOption(origin, payload.id, {
        id: payload.id,
        action: () => {
          const successIds = ids
            .filter((id) => Members.instance().denyTempMember(id));
          return Promise.resolve(successIds);
        },
      });
      ctx.response.body = option;
      ctx.response.status = 202;
    }
  } catch (err) {
    return ctx.response.status = hadleAMErrorToStatus(err);
  }
});

export default memberRouter;
