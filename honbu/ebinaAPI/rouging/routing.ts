import { oak } from "../../deps.ts";
import { NginxConf, NginxConfs } from "../../project_data/nginx.ts";
import { authToken } from "../../auth_manager/token.ts";
import { generateNginxConfsFromJson } from "../../project_data/nginx.ts";
import {
  execDCCPs,
  execDCCRestart,
  execDCCRm,
  execDCCUp,
} from "../../docker/DockerComposeCommand.ts";
import { ServiceName } from "../../ebina_docker_compose.ts";

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

  if (isChanged) {
    nginxConfs.setConf(route, conf);
    ctx.response.status = 201;
  } else {
    ctx.response.status = 200;
  }
});

// ルート詳細
routingRouter.get("/status", authToken, async (ctx) => {
  ctx.response.body = await containerState("Jinji");
  ctx.response.status = 200;
});

// ルート詳細
routingRouter.put("/status", authToken, async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  const status = body.status;
  if (!status) return ctx.response.status = 400;

  ctx.response.status = await updateNginxStatus(status) ?? 500;
});

export default routingRouter;

const getDoclerComposePs = async (name: string) => {
  const ret = await execDCCPs(name).catch((msg) => {
    console.log(msg);
    return undefined;
  });
  if (ret) {
    const retArray = ret.output.split("\n");
    if (retArray.length <= 3) {
      return "Removed";
    } else {
      const stateIdx = retArray[0].indexOf("State");
      const stateEndIdx = retArray[2].indexOf(" ", stateIdx);
      const state = retArray[2].substring(stateIdx, stateEndIdx);
      return state; // Up Paused Exit
    }
  } else {
    return "error";
  }
};

export const containerState = async (name: string) => {
  return await getDoclerComposePs(name);
};

const setNginxStatus = async (status: string) => {
  switch (status) {
    case "up": {
      generateNginxConfsFromJson();
      return await execDCCUp(ServiceName.Jinji)
        .then(() => 200)
        .catch((msg) => {
          console.log(msg);
          return 500;
        });
    }
    case "restart": {
      generateNginxConfsFromJson();
      return await execDCCRestart(ServiceName.Jinji)
        .then(() => 200)
        .catch((msg) => {
          console.log(msg);
          return 500;
        });
    }
    case "rm": {
      generateNginxConfsFromJson();
      return await execDCCRm(ServiceName.Jinji)
        .then(() => 200)
        .catch((msg) => {
          console.log(msg);
          return 500;
        });
    }
    default:
      return 400;
  }
};

export const updateNginxStatus = async (status: string) => {
  return await setNginxStatus(status);
};
