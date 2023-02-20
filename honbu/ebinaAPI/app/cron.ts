import { Context, Hono } from "hono/mod.ts";
import { CronItem, CronItemVales } from "../../project_data/apps/cron.ts";
import { getApp } from "../../project_data/apps/mod.ts";
import { authToken, AuthTokenVariables } from "../../auth_manager/token.ts";

const cronRouter = new Hono<{ Variables: AuthTokenVariables }>();

cronRouter.get("/", authToken, (c: Context) => {
  const { appName } = c.req.param();
  if (!appName) return c.json({}, 400);

  const cronItems = getApp(appName)?.cron;
  const cronNames = cronItems?.getItemNames();
  return c.json(cronNames, 200);
});

cronRouter.post("/:cronName", authToken, async (c: Context) => {
  const { appName, cronName } = c.req.param();
  if (!appName) return c.json({}, 400);

  const body = await c.req.json<CronItemVales>();
  const enableEx = body.enable !== undefined;
  const patternEx = body.pattern !== undefined;
  const functionEx = body.function !== undefined;
  if (!enableEx || !patternEx || !functionEx) {
    return c.json({}, 400);
  }

  const cronItems = getApp(appName)?.cron;
  if (!cronItems || cronItems.getItem(cronName)) {
    return c.json({}, 409);
  }

  cronItems.setCron(
    cronName,
    new CronItem(appName, {
      enable: body.enable,
      pattern: body.pattern,
      function: body.function,
    }),
  );

  return c.json({}, 200);
});

cronRouter.get("/:cronName", authToken, (c: Context) => {
  const { appName, cronName } = c.req.param();
  if (!appName) return c.json({}, 400);

  const cronItems = getApp(appName)?.cron;
  const cronItem = cronItems?.getItem(cronName);
  if (cronItem) {
    return c.json(cronItem.getRawValues());
  } else {
    return c.json({}, 404);
  }
});

cronRouter.patch("/:cronName", authToken, async (c: Context) => {
  const { appName, cronName } = c.req.param();
  if (!appName) return c.json({}, 400);

  const body = await c.req.json<
    { enable: boolean; pattern: string; function: string }
  >();
  const enableEx = body.enable !== undefined;
  const patternEx = body.pattern !== undefined;
  const functionEx = body.function !== undefined;
  if (!enableEx && !patternEx && !functionEx) {
    return c.json({}, 400);
  }

  const cronItems = getApp(appName)?.cron;
  const cronItem = cronItems?.getItem(cronName);
  if (!cronItems || !cronItem) return c.json({}, 404);
  if (enableEx) cronItem.setEnable(body.enable);
  if (patternEx) cronItem.setPattern(body.pattern);
  if (functionEx) cronItem.setFunctionStr(body.function);

  cronItems.setCron(cronName, cronItem);

  return c.json({}, 200);
});

cronRouter.delete("/:cronName", authToken, (c: Context) => {
  const { appName, cronName } = c.req.param();
  if (!appName) return c.json({}, 400);

  const cronItems = getApp(appName)?.cron;
  const cronItem = cronItems?.getItem(cronName);
  if (!cronItems || !cronItem) return c.json({}, 404);

  cronItems.setCron(cronName, undefined);

  return c.json({}, 200);
});

export default cronRouter;
