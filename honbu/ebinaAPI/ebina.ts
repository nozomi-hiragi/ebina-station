import { AuthManager, handleAMErrorToStatus } from "../auth_manager/mod.ts";
import { authToken } from "../auth_manager/token.ts";
import { oak } from "../deps.ts";
import { SH_DIR } from "../project_data/mod.ts";
import appRouter from "./app/app.ts";
import databaseRouter from "./database/database.ts";
import iRouter from "./i/i.ts";
import memberRouter from "./member/member.ts";
import routingRouter from "./rouging/routing.ts";
import settingsRouter from "./settings/settings.ts";

const ebinaRouter = new oak.Router();

ebinaRouter.use("/i", iRouter.routes());
ebinaRouter.use("/member", memberRouter.routes());
ebinaRouter.use("/app", appRouter.routes());
ebinaRouter.use("/settings", settingsRouter.routes());
ebinaRouter.use("/database", databaseRouter.routes());
ebinaRouter.use("/routing", routingRouter.routes());

ebinaRouter.post("/ex", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const body = await ctx.request.body({ type: "json" }).value;

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const ret = await am.verifyAuthResponse(origin, payload.id, body);
      return ctx.response.status = ret ? 200 : 422;
    } else {
      const n: string | undefined = body.n;
      const o: string[] | undefined = body.o;
      if (!n) return ctx.response.status = 400;

      const option = await am.createAuthOption(origin, payload.id, {
        id: payload.id,
        action: () => {
          try {
            Deno.statSync(SH_DIR);
            const cmd = [`${SH_DIR}/${n}.sh`];
            if (o) cmd.push(...o);
            Deno.run({ cmd });
            return Promise.resolve(true);
          } catch {
            return Promise.resolve(false);
          }
        },
      });
      ctx.response.body = option;
      ctx.response.status = 202;
    }
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
  }
});

export default ebinaRouter;
