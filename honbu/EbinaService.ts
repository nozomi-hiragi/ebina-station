import { config } from "https://deno.land/x/dotenv@v3.2.0/mod.ts";
import { getNetworkAddr } from "https://deno.land/x/local_ip@0.0.3/mod.ts";
import { rmService } from "./DockerComposeController.ts";
import {
  DockerComposeYamlManager,
  DockerComposeYamlService,
} from "./DockerComposeYamlManager.ts";
import { generateNginxConfsFromJson } from "./honbuAPI.ts";
import { isDockerDesktop, isExist } from "./utils.ts";

export enum ServiceName {
  Koujou = "Koujou",
  Jinji = "Jinji",
  mongodb = "mongodb",
  certbot = "certbot",
}

const volumesLetsencrypt = [
  "./project/letsencrypt:/etc/letsencrypt",
  "./project/letsencrypt/html:/var/www/html",
];

type HonbuParams = {
  key: string;
  port: number;
};

const createKoujouSettings = async (
  honbuParams: HonbuParams,
  koujouPort: number,
  env: string[],
) => {
  const serviceKoujou: DockerComposeYamlService = {
    build: "./koujou",
    image: "ebina-station-api",
    container_name: "EbinaStationKoujou",
    volumes: ["./project:/app/project"],
  };

  await Promise.all([
    isDockerDesktop().then((isDesktop) => {
      if (isDesktop) serviceKoujou.ports = [`${koujouPort}:${koujouPort}`];
      else serviceKoujou.network_mode = "host";
    }),
    getNetworkAddr().then((ipAddress) => {
      serviceKoujou.environment = env.concat([
        "HONBU=true",
        `HONBU_ADDRESS=${ipAddress}`,
        `HONBU_PORT=${honbuParams.port}`,
        `HONBU_KEY=${honbuParams.key}`,
      ]);
    }),
  ]);

  return serviceKoujou;
};

const createMongoSettings = (port: number, env: string[]) => {
  return {
    image: "mongo",
    container_name: "EbinaStationDB",
    command: `mongod --port ${port}`,
    restart: "always",
    environment: env,
    ports: [`${port}:${port}`],
    volumes: [
      "./mongodb/mongo_db:/data/db",
      "./mongodb/initdb.d:/docker-entrypoint-initdb.d",
    ],
  } as DockerComposeYamlService;
};

const createJinjiSettings = () => {
  let nginxConf: string;
  try {
    nginxConf = Deno.readTextFileSync("./project/nginx/nginx.conf");
  } catch {
    Deno.mkdirSync("./project/nginx/", { recursive: true });
    Deno.copyFileSync("./nginx.conf.base", "./project/nginx/nginx.conf");
    nginxConf = Deno.readTextFileSync("./project/nginx/nginx.conf");
  }
  if (nginxConf.includes("include /etc/nginx/generate/includes.conf;")) {
    generateNginxConfsFromJson();
  }

  const volumes = [
    "./project/nginx/nginx.conf:/etc/nginx/nginx.conf",
    "./project/nginx/sites-enabled:/etc/nginx/sites-enabled",
    "./project/nginx/generate:/etc/nginx/generate",
  ].concat(volumesLetsencrypt);
  if (isExist("/etc/ssl/certs/dhparam.pem")) {
    volumes.push("/etc/ssl/certs/dhparam.pem:/etc/ssl/certs/dhparam.pem");
  }

  return {
    image: "nginx:latest",
    container_name: "EbinaStationJinji",
    restart: "always",
    depends_on: [ServiceName.Koujou],
    ports: ["80:80", "443:443"],
    volumes,
  } as DockerComposeYamlService;
};

const createCertbotSettings = () => {
  return {
    image: "certbot/certbot",
    depends_on: [ServiceName.Jinji],
    volumes: volumesLetsencrypt,
  } as DockerComposeYamlService;
};

export const initDockerComposeFile = async (
  honbuParams: HonbuParams,
  koujouPort: number,
  mongodbPort?: number,
) => {
  await Promise.all([
    rmService(ServiceName.Koujou).catch(() => {}),
    rmService(ServiceName.Jinji).catch(() => {}),
    rmService(ServiceName.mongodb).catch(() => {}),
    rmService(ServiceName.certbot).catch(() => {}),
  ]);

  const koujouEnv = config({ path: "./koujou/.env" });
  const koujouEnvKeys = Object.keys(koujouEnv)
    .map((key) => `${key}=${koujouEnv[key]}`);

  const dockerComposeYaml = new DockerComposeYamlManager();

  const koujouService = await createKoujouSettings(
    honbuParams,
    koujouPort,
    koujouEnvKeys,
  );
  dockerComposeYaml.setService(ServiceName.Koujou, koujouService);

  if (mongodbPort) {
    const mongoService = createMongoSettings(mongodbPort, koujouEnvKeys);
    dockerComposeYaml.setService(ServiceName.mongodb, mongoService);
  }

  const jinjiService = createJinjiSettings();
  dockerComposeYaml.setService(ServiceName.Jinji, jinjiService);

  const certbotService = createCertbotSettings();
  dockerComposeYaml.setService(ServiceName.certbot, certbotService);

  dockerComposeYaml.saveToFile();
};
