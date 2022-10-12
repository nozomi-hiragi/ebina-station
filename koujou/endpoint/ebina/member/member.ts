import { oak } from "../../../deps.ts";
import { authToken } from "../../../utils/auth.ts";
import { logApi } from "../../../utils/log.ts";
import { getMembers } from "../../../settings/members/members.ts";

const memberRouter = new oak.Router();

// メンバー作成
// { id, name, pass }
// 201 できた
// 400 情報足らない
// 406 IDがもうある˝
memberRouter.post("/", authToken, async (ctx) => {
  const { id, name, pass } = await ctx.request.body({ type: "json" }).value;
  if (!id || !name || !pass) return ctx.response.status = 400;

  if (getMembers().registMember(id, name, pass)) {
    ctx.response.status = 201;
  } else {
    logApi.info("member/regest", "already have this id", id);
    ctx.response.status = 406;
  }
});

// メンバー配列取得 ID無いなら全部
// ?ids
// 200 空でも返す
memberRouter.get("/", authToken, (ctx) => {
  const ids = ctx.request.url.searchParams.get("ids")?.split(",") ?? [];

  ctx.response.body = getMembers().getMembersArray(ids);
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
    if (!getMembers().removeMember(id)) failedIds.push(id);
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

  const member = getMembers().getMember(id);
  if (member) {
    ctx.response.body = { ...member, auth: undefined };
  } else {
    ctx.response.status = 404;
  }
});

export default memberRouter;
