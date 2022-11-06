import { config, getNetworkAddr } from "./deps.ts";
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
  isDesktop: boolean,
  env: string[],
) => {
  const serviceKoujou: DockerComposeYamlService = {
    build: "./koujou",
    image: "ebina-station-api",
    container_name: "EbinaStationKoujou",
    volumes: ["./project:/app/project"],
  };

  if (isDesktop) serviceKoujou.ports = [`${koujouPort}:${koujouPort}`];
  else serviceKoujou.network_mode = "host";

  // 取れない時がある unstable外れたら変える
  await getNetworkAddr().then((ipAddress) => {
    serviceKoujou.environment = env.concat([
      "HONBU=true",
      `HONBU_ADDRESS=${ipAddress ?? "localhost"}`,
      `HONBU_PORT=${honbuParams.port}`,
      `HONBU_KEY=${honbuParams.key}`,
    ]);
  });

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

const createJinjiSettings = (isDesktop: boolean) => {
  const info = isExist("./project/nginx/nginx.conf");
  if (!info) {
    Deno.mkdirSync("./project/nginx/", { recursive: true });
    Deno.copyFileSync("./nginx.conf.base", "./project/nginx/nginx.conf");
  } else if (!info.isFile) {
    throw new Error(`"./project/nginx/nginx.conf" is not file`);
  }
  generateNginxConfsFromJson(isDesktop);

  const volumes = [
    "./project/nginx/nginx.conf:/etc/nginx/nginx.conf",
    "./project/nginx/sites-enabled:/etc/nginx/sites-enabled",
    "./project/nginx/generate:/etc/nginx/generate",
  ].concat(volumesLetsencrypt);
  if (isExist("/etc/ssl/certs/dhparam.pem")) {
    volumes.push("/etc/ssl/certs/dhparam.pem:/etc/ssl/certs/dhparam.pem");
  }

  const serviceJinji: DockerComposeYamlService = {
    image: "nginx:latest",
    container_name: "EbinaStationJinji",
    restart: "always",
    depends_on: [ServiceName.Koujou],
    ports: ["80:80", "443:443"],
    volumes,
  } as DockerComposeYamlService;

  if (isDesktop) serviceJinji.ports = ["80:80", "443:443"];
  else serviceJinji.network_mode = "host";

  return serviceJinji;
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

  const isDesktop = await isDockerDesktop();

  const koujouService = await createKoujouSettings(
    honbuParams,
    koujouPort,
    isDesktop,
    koujouEnvKeys,
  );
  dockerComposeYaml.setService(ServiceName.Koujou, koujouService);

  if (mongodbPort) {
    const mongoService = createMongoSettings(mongodbPort, koujouEnvKeys);
    dockerComposeYaml.setService(ServiceName.mongodb, mongoService);
  }

  const jinjiService = createJinjiSettings(isDesktop);
  dockerComposeYaml.setService(ServiceName.Jinji, jinjiService);

  const certbotService = createCertbotSettings();
  dockerComposeYaml.setService(ServiceName.certbot, certbotService);

  dockerComposeYaml.saveToFile();
};
