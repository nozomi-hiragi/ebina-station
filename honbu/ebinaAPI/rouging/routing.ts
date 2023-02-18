import { Hono } from "hono/mod.ts";
import { StatusCode } from "hono/utils/http-status.ts";
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
import { logEbina } from "../../utils/log.ts";
import portRouter from "./port.ts";

const routingRouter = new Hono();

// ルート一覧
routingRouter.get("/", authToken, (c) => {
  const confs = NginxConfs.instance().getConfs();
  return c.json(Object.keys(confs), 200);
});

// ルート詳細
routingRouter.get("/route/:route", authToken, (c) => {
  const { route } = c.req.param();
  const conf = NginxConfs.instance().getConf(route);
  if (conf) {
    return c.json(conf, 200);
  } else {
    return c.json({}, 404);
  }
});

// ルート作成
routingRouter.post("/route/:route", authToken, async (c) => {
  const { route } = c.req.param();
  const body = await c.req.json<NginxConf>();
  if (
    body.hostname === undefined ||
    body.port === undefined
  ) {
    return c.json({}, 400);
  }
  const nginxConfs = NginxConfs.instance();
  if (nginxConfs.getConf(route)) {
    return c.json({}, 409);
  }
  nginxConfs.setConf(route, body);
  return c.json({}, 201);
});

// ルート削除
routingRouter.delete("/route/:route", authToken, (c) => {
  const { route } = c.req.param();
  return c.json({}, NginxConfs.instance().deleteConf(route) ? 200 : 404);
});

// ルート更新
routingRouter.put("/route/:route", authToken, async (c) => {
  const { route } = c.req.param();
  const body = await c.req.json<
    { hostname: string; port: number | "koujou" }
  >();

  let isChanged = false;
  const conf = NginxConfs.instance().getConf(route);
  if (!conf) return c.json({}, 404);
  if (body.hostname !== undefined) {
    conf.hostname = body.hostname;
    isChanged = true;
  }
  if (body.port !== undefined) {
    conf.port = body.port;
    isChanged = true;
  }

  if (isChanged) {
    NginxConfs.instance().setConf(route, conf);
    return c.json({}, 201);
  } else {
    return c.json({}, 200);
  }
});

// ルート詳細
routingRouter.get("/status", authToken, async (c) => {
  return c.json(await containerState("Jinji"), 200);
});

// ルート詳細
routingRouter.put("/status", authToken, async (c) => {
  const body = await c.req.json<{ status: string }>();
  const status = body.status;
  if (!status) return c.json({}, 400);

  return c.json({}, await updateNginxStatus(status) as StatusCode ?? 500);
});

routingRouter.route("/port", portRouter);
export default routingRouter;

const getDockerComposePs = async (name: string) => {
  const ret = await execDCCPs(name).catch((msg) => {
    logEbina.error("docker compose ps error:", msg);
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
  return await getDockerComposePs(name);
};

const setNginxStatus = async (status: string) => {
  switch (status) {
    case "up": {
      generateNginxConfsFromJson();
      return await execDCCUp(ServiceName.Jinji)
        .then(() => 200)
        .catch((msg) => {
          logEbina.error("nginx container up error:", msg);
          return 500;
        });
    }
    case "restart": {
      generateNginxConfsFromJson();
      return await execDCCRestart(ServiceName.Jinji)
        .then(() => 200)
        .catch((msg) => {
          logEbina.error("nginx container restart error:", msg);
          return 500;
        });
    }
    case "rm": {
      generateNginxConfsFromJson();
      return await execDCCRm(ServiceName.Jinji)
        .then(() => 200)
        .catch((msg) => {
          logEbina.error("nginx container rm error:", msg);
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
