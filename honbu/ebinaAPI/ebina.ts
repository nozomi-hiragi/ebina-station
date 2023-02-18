import { AuthManager, handleAMErrorToStatus } from "../auth_manager/mod.ts";
import { authToken, JwtPayload } from "../auth_manager/token.ts";
import { Hono } from "hono/mod.ts";
import { SH_DIR } from "../project_data/mod.ts";
import appRouter from "./app/app.ts";
import databaseRouter from "./database/database.ts";
import iRouter from "./i/i.ts";
import memberRouter from "./member/member.ts";
import routingRouter from "./rouging/routing.ts";
import settingsRouter from "./settings/settings.ts";
import { AuthenticationResponseJSON } from "../webauthn/fido2Wrap.ts";

const ebinaRouter = new Hono();

ebinaRouter.route("/i", iRouter);
ebinaRouter.route("/member", memberRouter);
ebinaRouter.route("/app", appRouter);
ebinaRouter.route("/settings", settingsRouter);
ebinaRouter.route("/database", databaseRouter);
ebinaRouter.route("/routing", routingRouter);

ebinaRouter.post("/ex", authToken, async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const body = await c.req.json<
    & AuthenticationResponseJSON
    & { type: string; n: string | undefined; o: string[] | undefined }
  >();

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const ret = await am.verifyAuthResponse(origin, payload.id, body);
      return c.json({}, ret ? 200 : 422);
    } else {
      const n: string | undefined = body.n;
      const o: string[] | undefined = body.o;
      if (!n) return c.json({}, 400);

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
      return c.json(option, 202);
    }
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

export default ebinaRouter;
