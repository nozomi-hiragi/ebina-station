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

export type NginxConf = {
  hostname: string;
  port: number | "koujou";
  ssl?: {
    certificate: string;
    certificateKey: string;
    trustedCertificate: string;
    dhparam?: string;
  };
  certbot?: boolean;
  certWebRoot?: boolean;
  resolver?: boolean;
};

const generateNginxConf = (
  isDesktop: boolean,
  name: string,
  conf: NginxConf,
) => {
  const port = conf.port === "koujou"
    ? getSettings().getPortNumber()
    : conf.port;

  let sslSettings = "";
  if (conf.certbot) {
    conf.ssl = {
      certificate: `/etc/letsencrypt/live/${conf.hostname}/fullchain.pem`,
      certificateKey: `/etc/letsencrypt/live/${conf.hostname}/privkey.pem`,
      trustedCertificate: `/etc/letsencrypt/live/${conf.hostname}/chain.pem`,
    };
    if (isExist("/etc/ssl/certs/dhparam.pem")) {
      conf.ssl.dhparam = "/etc/ssl/certs/dhparam.pem";
    }
  }
  if (conf.ssl) {
    sslSettings = `
    listen 443 ssl;
    listen [::]:443 ssl;
    ssl_certificate ${conf.ssl.certificate};
    ssl_certificate_key ${conf.ssl.certificateKey};${
      conf.ssl.dhparam
        ? `
    ssl_dhparam ${conf.ssl.dhparam};`
        : ""
    }
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 60m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate ${conf.ssl.trustedCertificate};`;
  }

  const koujouName = isDesktop ? "EbinaStationKoujou" : "localhost";
  const content = `server {
    listen 80;
    listen [::]:80;
    server_name ${conf.hostname};
    location / {
        proxy_pass http://${koujouName}:${port}/;
    }${
    conf.certWebRoot
      ? `
    location /.well-known/ {
      root /var/www/html;
    }`
      : ""
  }
${sslSettings}${
    conf.resolver
      ? `
    resolver 1.1.1.1 1.0.0.1 [2606:4700:4700::1111] [2606:4700:4700::1001] valid=300s; # Cloudflare
    resolver_timeout 5s;`
      : ""
  }}`;
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

export const generateNginxConfsFromJson = (isDesktop: boolean) => {
  const confsFilePath = "./project/nginx/confs.json";
  const generateDir = "./project/nginx/generate";

  if (isExist(generateDir)) Deno.removeSync(generateDir, { recursive: true });
  Deno.mkdirSync(generateDir, { recursive: true });

  if (!isExist(confsFilePath)) return;
  const confs = JSON.parse(Deno.readTextFileSync(confsFilePath));
  if (!confs) throw new Error("something wrong on ./project/nginx/confs.json");
  Object.keys(confs).forEach((name) => {
    const err = generateNginxConf(isDesktop, name, confs[name]);
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
  isDesktop: boolean,
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
        generateNginxConfsFromJson(isDesktop);
        ctx.response.status = await upService(ServiceName.Jinji)
          .then(() => 200)
          .catch((msg) => {
            console.log(msg);
            return 500;
          });
        break;
      }
      case "restart": {
        generateNginxConfsFromJson(isDesktop);
        ctx.response.status = await restartService(ServiceName.Jinji)
          .then(() => 200)
          .catch((msg) => {
            console.log(msg);
            return 500;
          });
        break;
      }
      case "rm": {
        generateNginxConfsFromJson(isDesktop);
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
