import { isString } from "std/encoding/_yaml/utils.ts";
import { Hono } from "hono/mod.ts";
import apiRouter from "./api.ts";
import jsRouter from "./scripts.ts";
import cronRouter from "./cron.ts";
import { authToken, AuthTokenVariables } from "../../auth_manager/token.ts";
import {
  changeAppName,
  createApp,
  deleteApp,
  getApp,
  getAppNameList,
} from "../../project_data/apps/mod.ts";

const appRouter = new Hono<{ Variables: AuthTokenVariables }>();

// アプリ配列取得
// 200 名前ら
appRouter.get("/", authToken, (c) => c.json(getAppNameList()));

// アプリ作成
// 200 OK
// 400 情報足らない
appRouter.post("/:appName", authToken, (c) => {
  const appName = c.req.param().appName;
  const appList = getAppNameList();
  const found = appList.find((name) =>
    name.toLowerCase() === appName.toLowerCase()
  );
  if (found) return c.json({ message: "Already use this name" }, 400);

  const ret = createApp(appName);
  return c.json({}, ret ? 200 : 409);
});

// アプリ取得 実質有無確認
// 200 あった
// 400 情報足らない
// 404 なかった
appRouter.get("/:appName", authToken, (c) => {
  const appName = c.req.param().appName;
  const appList = getAppNameList();
  const found = appList.find((name) =>
    name.toLowerCase() === appName.toLowerCase()
  );
  return c.json({}, found ? 200 : 404);
});

// アプリ削除 ゴミ箱に移動
// 200 OK
// 404 アプリない
// 500 フォルダ移動ミスった
appRouter.delete("/:appName", authToken, (c) => {
  const appName = c.req.param().appName;
  const appList = getAppNameList();
  const found = appList.find((name) =>
    name.toLowerCase() === appName.toLowerCase()
  );
  if (!found) return c.json({}, 404);

  return c.json({}, deleteApp(appName) ? 200 : 500);
});

// 名前設定
// 200 OK
// 400 情報足らない
appRouter.put("/:appName/name", authToken, async (c) => {
  const appName = c.req.param().appName;
  const { name } = await c.req.json<{ name: string }>();
  if (!name || !isString(name)) return c.json({}, 400);
  const ret = changeAppName(appName, name);
  return c.json({}, ret ? 200 : 409);
});

// init設定
// 200 OK
// 400 情報足らない
appRouter.put("/:appName/init", authToken, async (c) => {
  const appName = c.req.param().appName;
  const apis = getApp(appName)?.apis;
  if (!apis) return c.json({}, 404);
  const body = await c.req.json<{ filename: string; function: string }>();
  const value = !body.filename || !body.function ? undefined : body;
  apis.setInit(value);
  return c.json({}, 200);
});

// init取得
// 200 OK
// 400 情報足らない
appRouter.get("/:appName/init", authToken, (c) => {
  const appName = c.req.param().appName;
  const apis = getApp(appName)?.apis;
  if (!apis) return c.json({}, 404);
  return c.json(apis.getInit(), 200);
});

// final設定
// 200 OK
// 400 情報足らない
appRouter.put("/:appName/final", authToken, async (c) => {
  const appName = c.req.param().appName;
  const apis = getApp(appName)?.apis;
  if (!apis) return c.json({}, 404);
  const body = await c.req.json<{ filename: string; function: string }>();
  const value = !body.filename || !body.function ? undefined : body;
  apis.setFinal(value);
  return c.json({}, 200);
});

// final取得
// 200 OK
// 400 情報足らない
appRouter.get("/:appName/final", authToken, (c) => {
  const appName = c.req.param().appName;
  const apis = getApp(appName)?.apis;
  if (!apis) return c.json({}, 404);
  return c.json(apis.getFinal(), 200);
});

appRouter.route("/:appName/api", apiRouter);
appRouter.route("/:appName/script", jsRouter);
appRouter.route("/:appName/cron", cronRouter);

export default appRouter;
