import * as oak from "https://deno.land/x/oak@v10.6.0/mod.ts";
import { restartService } from "./DockerComposeController.ts";
import { ServiceName } from "./EbinaService.ts";
import { isExist } from "./utils.ts";

const generateDirPathInContainer = "/etc/nginx/generate";

type NginxConf = {
  hostname: string;
  port: number;
  www?: boolean;
};

const generateNginxConf = (name: string, conf: NginxConf) => {
  let content = `server {
    listen 80;
    listen [::]:80;
    server_name ${conf.hostname};
    location / {
        proxy_pass http://EbinaStationKoujou:${conf.port}/;
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
    Deno.mkdirSync("./project/nginx/generate", { recursive: true });
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
  if (!isExist(confsFilePath)) return;

  Deno.removeSync("./project/nginx/generate", { recursive: true });
  const includes: string[] = [];

  const confs = JSON.parse(Deno.readTextFileSync(confsFilePath));
  Object.keys(confs).forEach((name) => {
    const ret = generateNginxConf(name, confs[name]);
    if (ret) console.log(ret);
    else includes.push(`include ${generateDirPathInContainer}/${name}.conf;`);
  });

  const includesConfPath = "./project/nginx/generate/includes.conf";
  Deno.writeTextFileSync(includesConfPath, includes.join("\n"));
};

export const createHonbuRouter = (honbuKey: string) => {
  const router = new oak.Router();

  router.post("/ping", async (ctx) => {
    const body = await ctx.request.body({ type: "json" }).value;
    if (body.key === honbuKey) {
      console.log("ok from ", ctx.request.ip);
      ctx.response.status = 200;
    } else {
      console.log("wrong key");
      ctx.response.status = 400;
      ctx.response.body = "wrong key";
    }
  });

  router.put("/nginx/status", async (ctx) => {
    const body = await ctx.request.body({ type: "json" }).value;
    const status = body.status;
    switch (status) {
      case "restart":
        generateNginxConfsFromJson();
        restartService(ServiceName.Jinji);
        break;

      default:
        return ctx.response.status = 400;
    }
    ctx.response.status = 200;
  });

  return router;
};
