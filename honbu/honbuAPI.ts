import { oak } from "./deps.ts";
import {
  psService,
  restartService,
  rmService,
  upService,
} from "./DockerComposeController.ts";
import { ServiceName } from "./EbinaService.ts";
import { isExist } from "./utils.ts";
import { getSettings } from "../koujou/settings/settings.ts";

type NginxConf = {
  hostname: string;
  port: number | "koujou";
  www?: boolean;
};

const generateNginxConf = (name: string, conf: NginxConf) => {
  const port = conf.port === "koujou"
    ? getSettings().getPortNumber()
    : conf.port;
  let content = `server {
    listen 80;
    listen [::]:80;
    server_name ${conf.hostname};
    location / {
        proxy_pass http://EbinaStationKoujou:${port}/;
    }
}`;
  if (conf.www) {
    content += `
server {
    listen 80;
    listen [::]:80;
    server_name www.${conf.hostname};
    return 301 $scheme://${conf.hostname}$request_uri;
}`;
  }
  try {
    const generateDir = "./project/nginx/generate";
    if (!isExist(generateDir)) Deno.mkdirSync(generateDir, { recursive: true });
    Deno.writeTextFileSync(
      `./project/nginx/generate/${name}.conf`,
      content,
      {},
    );
    return undefined;
  } catch (err) {
    return err;
  }
};

export const generateNginxConfsFromJson = () => {
  const confsFilePath = "./project/nginx/confs.json";
  const generateDir = "./project/nginx/generate";

  if (isExist(generateDir)) Deno.removeSync(generateDir, { recursive: true });
  Deno.mkdirSync(generateDir, { recursive: true });

  if (!isExist(confsFilePath)) return;
  const confs = JSON.parse(Deno.readTextFileSync(confsFilePath));
  if (!confs) throw new Error("something wrong on ./project/nginx/confs.json");
  Object.keys(confs).forEach((name) => {
    const err = generateNginxConf(name, confs[name]);
    if (err) console.log(err);
  });
};

const createAuthKeyFunc = (honbuKey: string) => {
  return async (ctx: oak.Context, next: () => Promise<unknown>) => {
    const authKey = ctx.request.headers.get("key");
    if (!authKey) return ctx.response.status = 401;

    if (authKey === honbuKey) {
      ctx.state.key = authKey;
      await next();
    } else {
      console.log("wrong key", ctx.request);
      ctx.response.status = 401;
    }
  };
};

export const createHonbuRouter = (
  honbuKey: string,
  onConnectedKoujou?: () => void,
) => {
  const authKey = createAuthKeyFunc(honbuKey);
  const router = new oak.Router();

  router.post("/ping", authKey, (ctx) => {
    console.log("ok from ", ctx.request.ip);
    ctx.response.status = 200;
    onConnectedKoujou && onConnectedKoujou();
  });

  router.put("/nginx/status", authKey, async (ctx) => {
    const body = await ctx.request.body({ type: "json" }).value;
    const status = body.status;
    switch (status) {
      case "up": {
        generateNginxConfsFromJson();
        ctx.response.status = await upService(ServiceName.Jinji)
          .then(() => 200)
          .catch((msg) => {
            console.log(msg);
            return 500;
          });
        break;
      }
      case "restart": {
        generateNginxConfsFromJson();
        ctx.response.status = await restartService(ServiceName.Jinji)
          .then(() => 200)
          .catch((msg) => {
            console.log(msg);
            return 500;
          });
        break;
      }
      case "rm": {
        generateNginxConfsFromJson();
        ctx.response.status = await rmService(ServiceName.Jinji)
          .then(() => 200)
          .catch((msg) => {
            console.log(msg);
            return 500;
          });
        break;
      }
      default:
        return ctx.response.status = 400;
    }
  });

  router.get("/dockercompose/ps/:name", authKey, async (ctx) => {
    const name = ctx.params.name;
    const ret = await psService(name).catch((msg) => {
      console.log(msg);
      return undefined;
    });
    if (ret) {
      const retArray = ret.output.split("\n");
      if (retArray.length <= 3) {
        ctx.response.body = "Removed";
      } else {
        const stateIdx = retArray[0].indexOf("State");
        const stateEndIdx = retArray[2].indexOf(" ", stateIdx);
        const state = retArray[2].substring(stateIdx, stateEndIdx);
        ctx.response.body = state; // Up Paused Exit
      }
      ctx.response.status = 200;
    } else {
      ctx.response.status = 500;
    }
  });

  return router;
};
