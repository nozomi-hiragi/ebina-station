import { oak } from "../../deps.ts";
import { authToken } from "../../auth_manager/token.ts";
import { APIItemValuesV2 } from "../../project_data/apps/apis.ts";
import { APPS_DIR } from "../../project_data/mod.ts";
import { getApp } from "../../project_data/apps/mod.ts";
import { getPort } from "../../project_data/apps/ports.ts";
import { SCRIPTS_DIR } from "../../project_data/apps/scripts.ts";

globalThis.addEventListener("unload", () => {
  Object.values(entrances).forEach((it) => it?.entranceProc?.kill("SIGINT"));
});

interface EntranceArgs {
  appDirPath: string;
  port: number;
  init?: {
    filename: string;
    function: string;
  };
  final?: {
    filename: string;
    function: string;
  };
}

const apiRouter = new oak.Router();

const entrances: {
  [name: string]: {
    entranceProc: Deno.Process | null;
    startedDate: number | null;
  } | undefined;
} = {};

// API起動状態取得
// 200 { status: 'started' | 'stop', started_at: number }
apiRouter.get("/status", authToken, (ctx) => {
  const { appName } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  const entrance = entrances[appName];
  const isStarted = entrance && entrance.entranceProc;
  ctx.response.body = {
    status: isStarted ? "started" : "stop",
    started_at: isStarted ? entrance.startedDate : undefined,
  };
});

// API起動状態更新
// { status: 'start' | 'stop' }
// 200 できた
// 400 情報おかしい
// 500 起動できなかった
apiRouter.put("/status", authToken, async (ctx) => {
  const { appName } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  const { status } = await ctx.request.body({ type: "json" }).value;
  if (!status) return ctx.response.status = 400;
  const isStop = status === "stop";
  const entrance = entrances[appName];
  const app = getApp(appName);

  if (entrance && entrance.entranceProc) {
    entrance.entranceProc.kill("SIGINT");
    entrance.entranceProc = null;
    entrance.startedDate = null;
    if (isStop) return ctx.response.body = { message: "stop" };
  } else if (isStop) return ctx.response.body = { message: "already stoped" };

  switch (status) {
    case "start": {
      const appDirPath = `${APPS_DIR}/${appName}`;
      const args: EntranceArgs = {
        appDirPath,
        port: getPort(appName)!,
        init: app?.apis.getInit(),
        final: app?.apis.getFinal(),
      };
      const entranceProc = Deno.run({
        cmd: [
          "deno",
          "run",
          "--allow-net",
          `--allow-read=${appDirPath}`,
          `${appDirPath}/${SCRIPTS_DIR}/entrance.ts`,
          JSON.stringify(args),
        ],
      });
      const startedDate = Date.now();

      entrances[appName] = { entranceProc, startedDate };
      ctx.response.body = { message: "start" };
      break;
    }

    default:
      ctx.response.status = 400;
      break;
  }
});

// ポート取得互換 @TODO 消す
apiRouter.get("/port", authToken, (ctx) => {
  const { appName } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  const url = ctx.request.url;
  const encodedAppName = encodeURIComponent(appName);
  url.pathname = url.pathname.replace(
    `app/${encodedAppName}/api/port`,
    `routing/port/number/${encodedAppName}`,
  );
  ctx.response.redirect(url);
  ctx.response.status = 308;
});

// ポート設定互換 @TODO 消す
apiRouter.put("/port", authToken, (ctx) => {
  const { appName } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  const url = ctx.request.url;
  const encodedAppName = encodeURIComponent(appName);
  url.pathname = url.pathname.replace(
    `app/${encodedAppName}/api/port`,
    `routing/port/number/${encodedAppName}`,
  );
  ctx.response.redirect(url);
  ctx.response.status = 308;
});

// API一覧取得
// 200 { path, api }
apiRouter.get("/endpoint", authToken, (ctx) => {
  const { appName } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  const apis = getApp(appName)?.apis;
  if (!apis) return ctx.response.status = 404;

  const apiList = apis.getAPIItemValueList();
  ctx.response.body = apiList;
});

// API取得
// :path
// 200 API
// 400 情報おかしい
// 404 ない
apiRouter.get("/endpoint/:path", authToken, (ctx) => {
  const { appName, path } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const apis = getApp(appName)?.apis;
  if (!apis) return ctx.response.status = 404;
  const api = apis.getAPIValue(path);
  if (api) {
    ctx.response.body = api;
  } else {
    ctx.response.status = 404;
  }
});

// API更新
// :path
// 200 OK
// 400 情報おかしい
apiRouter.put("/endpoint/:curPath", authToken, async (ctx) => {
  const { appName, curPath } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  const { name, path, method, filename, value } = await ctx.request
    .body({ type: "json" }).value;
  if (!name || !path || !method || !value) {
    return ctx.response.status = 400;
  }

  const apis = getApp(appName)?.apis;
  if (!apis) return ctx.response.status = 404;
  const api: APIItemValuesV2 = { name, path, method, filename, value };
  ctx.response.status = apis.updateAPI(curPath, api) ? 200 : 409;
});

// API削除
// 200 OK
// 400 情報おかしい
// 404 パスない
apiRouter.delete("/endpoint/:path", authToken, (ctx) => {
  const { appName, path } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const apis = getApp(appName)?.apis;
  if (!apis) return ctx.response.status = 404;
  ctx.response.status = apis.deleteAPI(path) ? 200 : 404;
});

export default apiRouter;
