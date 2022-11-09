import { oak } from "../../deps.ts";
import apiRouter from "./api.ts";
import jsRouter from "./scripts.ts";
import cronRouter from "./cron.ts";
import { authToken } from "../../utils/auth.ts";
import {
  createApp,
  deleteApp,
  getAppList,
} from "../../project_data/apps/mod.ts";

const appRouter = new oak.Router();

// アプリ配列取得
// 200 名前ら
appRouter.get("/", authToken, (ctx) => ctx.response.body = getAppList());

// アプリ作成
// 200 OK
// 400 情報足らない
appRouter.post("/:appName", authToken, (ctx) => {
  const appName = ctx.params.appName;
  const appList = getAppList();
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
  const appList = getAppList();
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
  const appList = getAppList();
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

appRouter.use("/:appName/api", apiRouter.routes());
appRouter.use("/:appName/script", jsRouter.routes());
appRouter.use("/:appName/cron", cronRouter.routes());

export default appRouter;
