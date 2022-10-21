import { isString, oak } from "../../deps.ts";
import { getMembers } from "../../settings/members/members.ts";
import { checkHonbuKey } from "../../utils/honbuDelegate.ts";

const honbuRouter = new oak.Router();

honbuRouter.get("/member/temp/list", checkHonbuKey, (ctx) => {
  const tempMembers = getMembers().getTempMembers();
  const tempMemberArray = Object.keys(tempMembers)
    .map((id) => ({ id, ...tempMembers[id]?.getValue() }));
  ctx.response.status = 201;
  ctx.response.body = tempMemberArray;
});

// 200 ok
// 400 idない
// 404 idいない
// 409 idだぶり
honbuRouter.post("/member/temp/admit", checkHonbuKey, async (ctx) => {
  const { id } = await ctx.request.body({ type: "json" }).value;
  if (!id || !isString(id)) return ctx.response.status = 400;

  const res = getMembers().admitTempMember(id);
  if (res === undefined) return ctx.response.status = 404;

  ctx.response.status = res ? 200 : 409;
});

// 200 ok
// 400 idない
// 404 idいない
honbuRouter.post("/member/temp/deny", checkHonbuKey, async (ctx) => {
  const { id } = await ctx.request.body({ type: "json" }).value;
  if (!id || !isString(id)) return ctx.response.status = 400;

  const res = getMembers().denyTempMember(id);
  ctx.response.status = res ? 200 : 404;
});

export default honbuRouter;
