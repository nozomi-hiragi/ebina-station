import { config } from "./deps.ts";
import { execDCCRm } from "./docker/DockerComposeCommand.ts";
import {
  DockerComposeYamlManager,
  DockerComposeYamlService,
} from "./docker/DockerComposeYamlManager.ts";
import { generateNginxConfsFromJson } from "./nginx_conf.ts";
import { isDockerDesktop, isExist } from "./utils.ts";

export enum ServiceName {
  Jinji = "Jinji",
  mongodb = "mongodb",
  certbot = "certbot",
}

const volumesLetsencrypt = [
  "./project/letsencrypt:/etc/letsencrypt",
  "./project/letsencrypt/html:/var/www/html",
];

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
  generateNginxConfsFromJson();

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

export const initDockerComposeFile = async (mongodbPort?: number) => {
  await Promise.all([
    execDCCRm(ServiceName.Jinji).catch(() => {}),
    execDCCRm(ServiceName.mongodb).catch(() => {}),
    execDCCRm(ServiceName.certbot).catch(() => {}),
  ]);

  const koujouEnv = config({ path: "./koujou/.env" });
  const koujouEnvKeys = Object.keys(koujouEnv)
    .map((key) => `${key}=${koujouEnv[key]}`);

  const dockerComposeYaml = new DockerComposeYamlManager();

  const isDesktop = await isDockerDesktop();

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
