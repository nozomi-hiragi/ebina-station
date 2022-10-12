import { oak } from "../../deps.ts";
import { getMembers } from "../../settings/members/members.ts";
import { checkHonbuKey } from "../../utils/honbuDelegate.ts";

const honbuRouter = new oak.Router();

honbuRouter.post("/member/new", checkHonbuKey, async (ctx) => {
  const { id, name, pass, admin } = await ctx.request
    .body({ type: "json" }).value;
  if (!id || !name || !pass) return ctx.response.status = 400;

  if (getMembers().registMember(id, name, pass, admin)) {
    ctx.response.status = 201;
  } else {
    console.log("post adminUser", "already have this id", id);
    ctx.response.status = 406;
  }
});

export default honbuRouter;
