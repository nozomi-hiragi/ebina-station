import { oak } from "../../../deps.ts";
import { NginxConf, NginxConfs } from "../../../settings/nginx.ts";
import { authToken } from "../../../utils/auth.ts";
import {
  containerState,
  isEnableHonbu,
  updateNginxStatus,
} from "../../../utils/honbuDelegate.ts";

export const nginxConfs = new NginxConfs();

const routingRouter = new oak.Router();

// ルート一覧
routingRouter.get("/", authToken, (ctx) => {
  const confs = nginxConfs.getConfs();
  ctx.response.status = 200;
  ctx.response.body = Object.keys(confs);
});

// ルート詳細
routingRouter.get("/route/:route", authToken, (ctx) => {
  const { route } = ctx.params;
  const conf = nginxConfs.getConf(route);
  if (conf) {
    ctx.response.status = 200;
    ctx.response.body = conf;
  } else {
    ctx.response.status = 404;
  }
});

// ルート作成
routingRouter.post("/route/:route", authToken, async (ctx) => {
  const { route } = ctx.params;
  const body = await ctx.request.body({ type: "json" }).value as NginxConf;
  if (
    body.hostname === undefined ||
    body.port === undefined
  ) {
    return ctx.response.status = 400;
  }
  if (nginxConfs.getConf(route)) {
    return ctx.response.status = 409;
  }
  nginxConfs.setConf(route, body);
  ctx.response.status = 201;
});

// ルート削除
routingRouter.delete("/route/:route", authToken, (ctx) => {
  const { route } = ctx.params;
  ctx.response.status = nginxConfs.deleteConf(route) ? 200 : 404;
});

// ルート更新
routingRouter.put("/route/:route", authToken, async (ctx) => {
  const { route } = ctx.params;
  const body = await ctx.request.body({ type: "json" }).value;

  let isChanged = false;
  const conf = nginxConfs.getConf(route);
  if (!conf) return ctx.response.status = 404;
  if (body.hostname !== undefined) {
    conf.hostname = body.hostname;
    isChanged = true;
  }
  if (body.port !== undefined) {
    conf.port = body.port;
    isChanged = true;
  }
  if (body.www !== undefined) {
    conf.www = body.www;
    isChanged = true;
  }

  if (isChanged) {
    nginxConfs.setConf(route, conf);
    ctx.response.status = 201;
  } else {
    ctx.response.status = 200;
  }
});

// ルート詳細
routingRouter.get("/status", authToken, async (ctx) => {
  if (isEnableHonbu()) {
    ctx.response.body = await containerState("Jinji");
  } else {
    ctx.response.body = "Disable";
  }
  ctx.response.status = 200;
});

// ルート詳細
routingRouter.put("/status", authToken, async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  const status = body.status;
  if (!status) return ctx.response.status = 400;

  if (isEnableHonbu()) {
    ctx.response.status = await updateNginxStatus(status) ?? 500;
  } else {
    ctx.response.status = 503;
  }
});

export default routingRouter;
