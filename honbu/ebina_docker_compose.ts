import { config } from "./deps.ts";
import { isDockerDesktop } from "./docker/docker.ts";
import { execDCCRm, execDCCUp } from "./docker/DockerComposeCommand.ts";
import {
  DockerComposeYamlManager,
  DockerComposeYamlService,
} from "./docker/DockerComposeYamlManager.ts";
import { NGINX_DIR, PROJECT_PATH } from "./project_data/mod.ts";
import { generateNginxConfsFromJson } from "./project_data/nginx.ts";
import { Settings } from "./project_data/settings/mod.ts";
import { logger } from "./utils/log.ts";
import { isExist } from "./utils/utils.ts";

export enum ServiceName {
  Jinji = "Jinji",
  mongodb = "mongodb",
  certbot = "certbot",
}

const volumesLetsencrypt = [
  `${PROJECT_PATH}/letsencrypt:/etc/letsencrypt`,
  `${PROJECT_PATH}/letsencrypt/html:/var/www/html`,
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
  const nginxConfPath = `${NGINX_DIR}/nginx.conf`;
  const info = isExist(nginxConfPath);
  if (!info) {
    Deno.mkdirSync(NGINX_DIR, { recursive: true });
    Deno.copyFileSync("./nginx.conf.base", nginxConfPath);
  } else if (!info.isFile) {
    throw new Error(`"${nginxConfPath}" is not file`);
  }
  generateNginxConfsFromJson();

  const volumes = [
    `${nginxConfPath}:/etc/nginx/nginx.conf`,
    `${NGINX_DIR}/sites-enabled:/etc/nginx/sites-enabled`,
    `${NGINX_DIR}/nginx/generate:/etc/nginx/generate`,
    `./logs/nginx:/var/log/nginx`,
  ].concat(volumesLetsencrypt);
  if (isExist("/etc/ssl/certs/dhparam.pem")) {
    volumes.push("/etc/ssl/certs/dhparam.pem:/etc/ssl/certs/dhparam.pem");
  }

  const serviceJinji: DockerComposeYamlService = {
    image: "nginx:latest",
    container_name: "EbinaStationJinji",
    restart: "always",
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

export const initDockerComposeFile = async () => {
  await Promise.all([
    execDCCRm(ServiceName.Jinji).catch(() => {}),
    execDCCRm(ServiceName.mongodb).catch(() => {}),
    execDCCRm(ServiceName.certbot).catch(() => {}),
  ]);

  const envObj = config({ path: "./.env" });
  const envKeys = Object.keys(envObj)
    .map((key) => `${key}=${envObj[key]}`);

  const dockerComposeYaml = new DockerComposeYamlManager();

  const mongodbPort = Settings.instance().Mongodb.getPortNumber();
  const mongoService = createMongoSettings(mongodbPort, envKeys);
  dockerComposeYaml.setService(ServiceName.mongodb, mongoService);

  const isDesktop = await isDockerDesktop();
  const jinjiService = createJinjiSettings(isDesktop);
  dockerComposeYaml.setService(ServiceName.Jinji, jinjiService);

  const certbotService = createCertbotSettings();
  dockerComposeYaml.setService(ServiceName.certbot, certbotService);

  dockerComposeYaml.saveToFile();
};

export const startContainers = async () => {
  await execDCCUp(ServiceName.mongodb);
  await execDCCUp(ServiceName.Jinji);
};

export const removeContainers = () => {
  return Promise.all([
    execDCCRm(ServiceName.Jinji).catch((msg) =>
      logger.error("remove jinji container error", msg)
    ),
  ]);
};
