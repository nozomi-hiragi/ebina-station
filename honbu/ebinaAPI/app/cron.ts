import { oak } from "../../deps.ts";
import { CronItem, getCronJson, setCron } from "../../project_data/cron.ts";
import { authToken } from "../../utils/auth.ts";

const cronRouter = new oak.Router();

cronRouter.get("/", authToken, (ctx) => {
  const { appName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const cronJson = getCronJson(appName);
  const cronNames = Object.keys(cronJson);
  ctx.response.body = cronNames;
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

  const cronJson = getCronJson(appName);
  if (cronJson[cronName]) return ctx.response.status = 409;

  const ret = await setCron(appName, cronName, {
    enable: body.enable,
    pattern: body.pattern,
    function: body.function,
  });

  ctx.response.status = ret ? 200 : 500;
});

cronRouter.get("/:cronName", authToken, (ctx) => {
  const { appName, cronName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const cronJson = getCronJson(appName);
  const cronItem = cronJson[cronName];
  if (cronItem) {
    ctx.response.body = cronItem;
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

  const cronJson = getCronJson(appName);
  const cronItem = cronJson[cronName] ?? {} as CronItem;
  const newCronItem: CronItem = {
    enable: enableEx ? body.enable : cronItem.enable,
    pattern: patternEx ? body.pattern : cronItem.pattern,
    function: functionEx ? body.function : cronItem.function,
  };

  if (
    newCronItem.enable === undefined ||
    newCronItem.function === undefined ||
    newCronItem.pattern === undefined
  ) {
    return ctx.response.status = 403;
  }

  const ret = await setCron(appName, cronName, newCronItem);

  ctx.response.status = ret ? 200 : 500;
});

cronRouter.delete("/:cronName", authToken, async (ctx) => {
  const { appName, cronName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const cronJson = getCronJson(appName);
  const cronItem = cronJson[cronName];
  if (!cronItem) return ctx.response.status = 404;

  const ret = await setCron(appName, cronName, undefined);

  ctx.response.status = ret ? 200 : 500;
});

export default cronRouter;
