import { isString, oak } from "../../deps.ts";
import { authToken } from "../../auth_manager/token.ts";
import { Members } from "../../project_data/members/mod.ts";
import { AuthManager, hadleAMErrorToStatus } from "../../auth_manager/mod.ts";

const memberRouter = new oak.Router();

// 仮登録
// { id, name, pass }
// 201 オプションあげる
// 400 パラメ足らん
// 409 メンバ競合
memberRouter.post("/regist/option", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const { id, name, pass } = await ctx.request.body({ type: "json" }).value;
  if (!id || !name || !pass) return ctx.response.status = 400;

  try {
    const option = await AuthManager.instance()
      .registTempMemberOption(origin, id, name, pass);
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
  const { id, result, token } = body;
  if (!id || !isString(id) || !result || !token || !isString(token)) {
    return ctx.response.status = 400;
  }

  try {
    await AuthManager.instance()
      .registTempMemberVerify(origin, id, token, result);
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
memberRouter.get("/:id", authToken, (ctx) => {
  const { id } = ctx.params;
  if (!id) return ctx.response.status = 400;

  const member = Members.instance().getMember(id);
  if (member) {
    ctx.response.body = { ...member, auth: undefined };
  } else {
    ctx.response.status = 404;
  }
});

export default memberRouter;
