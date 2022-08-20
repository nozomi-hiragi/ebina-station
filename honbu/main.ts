import * as oak from "https://deno.land/x/oak@v10.6.0/mod.ts";
import { getNetworkAddr } from "https://deno.land/x/local_ip@0.0.3/mod.ts";
import {
  DockerComposeYamlManager,
  DockerComposeYamlService,
} from "./DockerComposeYamlManager.ts";
import { isDockerDesktop, readReader } from "./utils.ts";
import { config } from "https://deno.land/x/dotenv@v3.2.0/mod.ts";
import { crypto } from "https://deno.land/std@0.152.0/crypto/mod.ts";
import { rmService, upService } from "./DockerComposeController.ts";

const port = 9876;
const koujouPort = 3456;

const initDockerComposeFile = async (honbuKey: string) => {
  const isDesktop = await isDockerDesktop();

  const dockerComposeYaml = new DockerComposeYamlManager();

  const ipAddress = await getNetworkAddr();
  const koujouEnv = config({ path: "./koujou/.env" });
  const koujouEnvArray = Object.keys(koujouEnv)
    .map((key) => `${key}=${koujouEnv[key]}`);
  const serviceKoujou: DockerComposeYamlService = {
    build: "./koujou",
    image: "ebina-station-api",
    container_name: "EbinaStationKoujou",
    volumes: ["./project:/app/project"],
    environment: koujouEnvArray.concat([
      "HONBU=true",
      `HONBU_ADDRESS=${ipAddress}`,
      `HONBU_PORT=${port}`,
      `HONBU_KEY=${honbuKey}`,
    ]),
  };
  if (isDesktop) serviceKoujou.ports = [`${koujouPort}:${koujouPort}`];
  else serviceKoujou.network_mode = "host";
  dockerComposeYaml.setService("Koujou", serviceKoujou);

  dockerComposeYaml.setService("EbinaStationDB", {
    image: "mongo",
    container_name: "EbinaStationDB",
    command: "mongod --port 27017",
    restart: "always",
    environment: koujouEnvArray,
    ports: ["27017:27017"],
    volumes: [
      "./mongodb/mongo_db:/data/db",
      "./mongodb/initdb.d:/docker-entrypoint-initdb.d",
    ],
  });

  dockerComposeYaml.setService("Jinji", {
    image: "nginx:latest",
    container_name: "EbinaStationJinji",
    restart: "always",
    depends_on: ["Koujou", "EbinaStationDB"],
    ports: ["80:80", "443:443"],
    volumes: [
      "./project/nginx/nginx.conf:/etc/nginx/nginx.conf",
      "./project/nginx/sites-enabled:/etc/nginx/sites-enabled",
      "./project/letsencrypt:/etc/letsencrypt",
      "./html:/var/www/html",
      "/etc/ssl/certs/dhparam.pem:/etc/ssl/certs/dhparam.pem",
    ],
  });

  dockerComposeYaml.setService("certbot", {
    image: "certbot/certbot",
    depends_on: ["Jinji"],
    volumes: [
      "./project/letsencrypt:/etc/letsencrypt",
      "./html:/var/www/html",
    ],
  });

  dockerComposeYaml.saveToFile("docker-compose.yml");
};

const main = async () => {
  const honbuKey = crypto.randomUUID() ?? "honbukey";
  await initDockerComposeFile(honbuKey);

  if (!await upService("EbinaStationDB")) Deno.exit(1);
  if (!await upService("Koujou")) Deno.exit(1);

  readReader(Deno.stdin, (msg: string) => {
    if (msg === "q") {
      rmService("Koujou").then((success) => Deno.exit(success ? 0 : 1));
      return true;
    } else if (!msg.indexOf("create")) {
      const commands = msg.split(" ");
      let paramType = undefined;
      const params = {} as {
        id?: string;
        name?: string;
        pass?: string;
        admin?: boolean;
      };
      for (const it of commands) {
        switch (paramType) {
          case undefined:
            paramType = it;
            break;

          case "create":
            if (it !== "member") {
              console.log("unsupport type");
              return;
            }
            paramType = undefined;
            break;

          case "-u":
            params.name = it;
            paramType = undefined;
            break;

          case "-i":
            params.id = it;
            paramType = undefined;
            break;

          case "-p":
            params.pass = it;
            paramType = undefined;
            break;

          case "-f":
            if (it === "admin") params.admin = true;
            paramType = undefined;
            break;
        }
      }
      if (
        params.name !== undefined &&
        params.id !== undefined &&
        params.pass !== undefined
      ) {
        fetch(`http://${"localhost"}:${koujouPort}/honbu/member/new`, {
          method: "POST",
          body: JSON.stringify(params),
          headers: { key: honbuKey },
        }).then((ret) => {
          if (ret.status !== 201) {
            console.error("failed create member", ret);
          }
        });
      } else {
        console.log("params are wrong");
      }
    } else {
      console.log("><");
    }
  });

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

  const app = new oak.Application();
  app.use(router.routes(), router.allowedMethods());
  app.listen({ port });
};

main();

Deno.addSignalListener("SIGTERM", () => {
  rmService("Koujou").then((success) => Deno.exit(success ? 0 : 1));
});
