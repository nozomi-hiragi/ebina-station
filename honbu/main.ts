import { Cron, oak } from "./deps.ts";
import { initProjectSettingsInteract, isExist, readReader } from "./utils.ts";
import {
  DockerComposeControllerExeption,
  rmService,
  upService,
} from "./DockerComposeController.ts";
import { initDockerComposeFile, ServiceName } from "./EbinaService.ts";
import { createHonbuRouter } from "./honbuAPI.ts";
import { getSettings, PROJECT_PATH } from "../koujou/settings/settings.ts";
import {
  executeAddRoute,
  MemberTempActions,
  runCertbotService,
} from "./CommandActions.ts";
import { KoujouAPI } from "./KoujouAPI.ts";

const removeBaseServices = () =>
  Promise.all([
    rmService(ServiceName.Koujou).catch((msg) => console.error(msg)),
    rmService(ServiceName.Jinji).catch((msg) => console.error(msg)),
  ]);

const exitHonbu = () =>
  removeBaseServices().then((successes) => {
    const isFailed = successes.find((success) => !success);
    Deno.exit(isFailed ? 1 : 0);
  });

const main = async () => {
  const pjInfo = isExist(PROJECT_PATH);
  if (pjInfo) {
    if (!pjInfo.isDirectory) throw new Error("project is not directory");
  } else {
    Deno.mkdir(PROJECT_PATH, { recursive: true });
    await initProjectSettingsInteract();
  }

  const projectSettings = getSettings();
  const mongoSettings = projectSettings.MongoDB;
  const koujouPort = projectSettings.getPortNumber();
  const honbuPort = projectSettings.getHonbuPortNumber();

  const honbuKey = crypto.randomUUID() ?? "honbukey";
  await initDockerComposeFile(
    { key: honbuKey, port: honbuPort },
    koujouPort,
    mongoSettings?.port,
  );

  if (mongoSettings) if (!await upService(ServiceName.mongodb)) Deno.exit(1);
  if (!await upService(ServiceName.Koujou)) Deno.exit(1);
  if (!await upService(ServiceName.Jinji)) Deno.exit(1);

  const koujouAPI = new KoujouAPI(honbuKey, koujouPort);

  readReader(Deno.stdin, (msg: string) => {
    const commands = msg.split(" ");
    if (msg === "q") {
      exitHonbu();
      return true;
    } else if (commands[0] === "member" && commands[1] === "temp") {
      const action = MemberTempActions.actionst[commands[2]];
      if (action) action(koujouAPI, commands[3]);
      else console.log("list, admit or deny");
    } else if (commands[0] === "certbot") {
      runCertbotService(commands)
        .then((ret) => {
          console.log(ret.output);
        }).catch((err: DockerComposeControllerExeption) => {
          console.log(err);
        });
    } else if (commands[0] === "route") {
      if (commands[1] === "add") executeAddRoute(koujouAPI, commands.slice(2));
      else console.log(`sub command "add"`);
    } else {
      console.log("><");
    }
  });

  const app = new oak.Application();
  const honbuRouter = createHonbuRouter(honbuKey);
  app.use(honbuRouter.routes(), honbuRouter.allowedMethods());
  app.listen({ port: honbuPort });
};

main().then(() => {
  console.log("Connect to Koujou...");
  const renewCron = new Cron("0 0 22-28 * 1", () => {
    runCertbotService(["certbot", "renew"]).then((ret) => {
      // @TODO ログに入れる
      console.log(`renew: ${ret}`);
    });
  });

  Deno.addSignalListener("SIGTERM", () => {
    renewCron.stop();
    exitHonbu();
  });
});
