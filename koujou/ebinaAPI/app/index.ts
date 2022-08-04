import { oak } from "../../deps.ts";
import apiRouter from "./api.ts";
import jsRouter from "./scripts.ts";
import cronRouter from "./cron.ts";
import { mkdirIfNotExist } from "../../utils/utils.ts";
import { authToken } from "../../utils/auth.ts";
import { logApi } from "../../utils/log.ts";

const FIRST_APP_NAME = "FirstApp";
export const PROJECT_PATH = "./project";
export const APPS_DIR = `${PROJECT_PATH}/apps`;
export const GOMI_DIR = `${PROJECT_PATH}/gomi`;

const appRouter = new oak.Router();

const getAppList = () => {
  const appList = [];
  for (const dirEntry of Deno.readDirSync(APPS_DIR)) {
    if (dirEntry.isDirectory) {
      appList.push(dirEntry.name);
    }
  }
  if (appList.length === 0) {
    mkdirIfNotExist(`${APPS_DIR}/${FIRST_APP_NAME}`);
    appList.push(FIRST_APP_NAME);
  }
  return appList;
};

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

  mkdirIfNotExist(`${APPS_DIR}/${appName}`);

  ctx.response.status = 200;
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

  mkdirIfNotExist(GOMI_DIR);

  try {
    Deno.renameSync(`${APPS_DIR}/${appName}`, `${GOMI_DIR}/${appName}`);
    ctx.response.status = 200;
  } catch (_) {
    logApi.error(["delete", "/app", "move folder failed", appName]);
    ctx.response.status = 500;
  }
});

appRouter.use("/:appName/api", apiRouter.routes());
appRouter.use("/:appName/scripts", jsRouter.routes());
appRouter.use("/:appName/cron", cronRouter.routes());

export default appRouter;
