import { oak } from "../../deps.ts";
import { CronItem } from "../../project_data/apps/cron.ts";
import { getApp } from "../../project_data/apps/mod.ts";
import { authToken } from "../../utils/auth.ts";

const cronRouter = new oak.Router();

cronRouter.get("/", authToken, (ctx) => {
  const { appName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const cronItems = getApp(appName)?.cron;
  const cronNames = cronItems?.getItemNames();
  ctx.response.body = cronNames;
  ctx.response.status = 200;
});

cronRouter.post("/:cronName", authToken, async (ctx) => {
  const { appName, cronName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const body = await ctx.request.body({ type: "json" }).value;
  const enableEx = body.enable !== undefined;
  const patternEx = body.pattern !== undefined;
  const functionEx = body.function !== undefined;
  if (!enableEx || !patternEx || !functionEx) {
    return ctx.response.status = 400;
  }

  const cronItems = getApp(appName)?.cron;
  if (!cronItems || cronItems.getItem(cronName)) {
    return ctx.response.status = 409;
  }

  cronItems.setCron(
    cronName,
    new CronItem(appName, {
      enable: body.enable,
      pattern: body.pattern,
      function: body.function,
    }),
  );

  ctx.response.status = 200;
});

cronRouter.get("/:cronName", authToken, (ctx) => {
  const { appName, cronName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const cronItems = getApp(appName)?.cron;
  const cronItem = cronItems?.getItem(cronName);
  if (cronItem) {
    ctx.response.body = cronItem.getRawValues();
  } else {
    ctx.response.status = 404;
  }
});

cronRouter.patch("/:cronName", authToken, async (ctx) => {
  const { appName, cronName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const body = await ctx.request.body({ type: "json" }).value;
  const enableEx = body.enable !== undefined;
  const patternEx = body.pattern !== undefined;
  const functionEx = body.function !== undefined;
  if (!enableEx && !patternEx && !functionEx) {
    return ctx.response.status = 400;
  }

  const cronItems = getApp(appName)?.cron;
  const cronItem = cronItems?.getItem(cronName);
  if (!cronItems || !cronItem) return ctx.response.status = 404;
  if (enableEx) cronItem.setEnable(body.enable);
  if (patternEx) cronItem.setPattern(body.pattern);
  if (functionEx) cronItem.setFunctionStr(body.function);

  cronItems.setCron(cronName, cronItem);

  ctx.response.status = 200;
});

cronRouter.delete("/:cronName", authToken, (ctx) => {
  const { appName, cronName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const cronItems = getApp(appName)?.cron;
  const cronItem = cronItems?.getItem(cronName);
  if (!cronItems || !cronItem) return ctx.response.status = 404;

  cronItems.setCron(cronName, undefined);

  ctx.response.status = 200;
});

export default cronRouter;
