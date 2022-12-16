import { oak } from "../../deps.ts";
import apiRouter from "./api.ts";
import jsRouter from "./scripts.ts";
import cronRouter from "./cron.ts";
import { authToken } from "../../auth_manager/token.ts";
import {
  createApp,
  deleteApp,
  getApp,
  getAppNameList,
} from "../../project_data/apps/mod.ts";

const appRouter = new oak.Router();

// アプリ配列取得
// 200 名前ら
appRouter.get("/", authToken, (ctx) => ctx.response.body = getAppNameList());

// アプリ作成
// 200 OK
// 400 情報足らない
appRouter.post("/:appName", authToken, (ctx) => {
  const appName = ctx.params.appName;
  const appList = getAppNameList();
  const found = appList.find((name) =>
    name.toLowerCase() === appName.toLowerCase()
  );
  if (found) {
    ctx.response.status = 400;
    return ctx.response.body = { message: "Already use this name" };
  }

  const ret = createApp(appName);
  ctx.response.status = ret ? 200 : 409;
});

// アプリ取得 実質有無確認
// 200 あった
// 400 情報足らない
// 404 なかった
appRouter.get("/:appName", authToken, (ctx) => {
  const appName = ctx.params.appName;
  const appList = getAppNameList();
  const found = appList.find((name) =>
    name.toLowerCase() === appName.toLowerCase()
  );
  ctx.response.status = found ? 200 : 404;
});

// アプリ削除 ゴミ箱に移動
// 200 OK
// 404 アプリない
// 500 フォルダ移動ミスった
appRouter.delete("/:appName", authToken, (ctx) => {
  const appName = ctx.params.appName;
  const appList = getAppNameList();
  const found = appList.find((name) =>
    name.toLowerCase() === appName.toLowerCase()
  );
  if (!found) return ctx.response.status = 404;

  if (deleteApp(appName)) {
    ctx.response.status = 200;
  } else {
    ctx.response.status = 500;
  }
});

// init設定
// 200 OK
// 400 情報足らない
appRouter.put("/:appName/init", authToken, async (ctx) => {
  const appName = ctx.params.appName;
  const apis = getApp(appName)?.apis;
  if (!apis) return ctx.response.status = 404;
  const body = await ctx.request.body({ type: "json" }).value;
  const value = !body.filename || !body.function ? undefined : body;
  apis.setInit(value);
  ctx.response.status = 200;
});

// init取得
// 200 OK
// 400 情報足らない
appRouter.get("/:appName/init", authToken, (ctx) => {
  const appName = ctx.params.appName;
  const apis = getApp(appName)?.apis;
  if (!apis) return ctx.response.status = 404;
  ctx.response.body = apis.getInit();
  ctx.response.status = 200;
});

// final設定
// 200 OK
// 400 情報足らない
appRouter.put("/:appName/final", authToken, async (ctx) => {
  const appName = ctx.params.appName;
  const apis = getApp(appName)?.apis;
  if (!apis) return ctx.response.status = 404;
  const body = await ctx.request.body({ type: "json" }).value;
  const value = !body.filename || !body.function ? undefined : body;
  apis.setFinal(value);
  ctx.response.status = 200;
});

// final取得
// 200 OK
// 400 情報足らない
appRouter.get("/:appName/final", authToken, (ctx) => {
  const appName = ctx.params.appName;
  const apis = getApp(appName)?.apis;
  if (!apis) return ctx.response.status = 404;
  ctx.response.body = apis.getFinal();
  ctx.response.status = 200;
});

appRouter.use("/:appName/api", apiRouter.routes());
appRouter.use("/:appName/script", jsRouter.routes());
appRouter.use("/:appName/cron", cronRouter.routes());

export default appRouter;
