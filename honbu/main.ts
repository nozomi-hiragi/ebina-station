import { Cron, oak, oakCors } from "./deps.ts";
import {
  initProjectSettingsInteract,
  isExist,
  readReader,
  RunCommandExeption,
} from "./utils.ts";
import { execDCCRm, execDCCUp } from "./docker/DockerComposeCommand.ts";
import { initDockerComposeFile, ServiceName } from "./EbinaService.ts";
import { getSettings, PROJECT_PATH } from "./settings/settings.ts";
import {
  executeAddRoute,
  MemberTempActions,
  runCertbotService,
} from "./CommandActions.ts";
import ebinaRouter from "./ebinaAPI/ebina.ts";
import { startCrons } from "./settings/cron.ts";

const removeBaseServices = () =>
  Promise.all([
    execDCCRm(ServiceName.Jinji).catch((msg) => console.error(msg)),
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
    await initProjectSettingsInteract();
  }

  const projectSettings = getSettings();
  const mongoSettings = projectSettings.MongoDB;
  const honbuPort = projectSettings.getHonbuPortNumber();

  await initDockerComposeFile(mongoSettings?.port);

  if (mongoSettings) if (!await execDCCUp(ServiceName.mongodb)) Deno.exit(1);
  if (!await execDCCUp(ServiceName.Jinji)) Deno.exit(1);

  readReader(Deno.stdin, (msg: string) => {
    const commands = msg.split(" ");
    if (msg === "q") {
      exitHonbu();
      return true;
    } else if (commands[0] === "member" && commands[1] === "temp") {
      const action = MemberTempActions.actionst[commands[2]];
      if (action) action(commands[3]);
      else console.log("list, admit or deny");
    } else if (commands[0] === "certbot") {
      runCertbotService(commands)
        .then((ret) => {
          console.log(ret.output);
        }).catch((err: RunCommandExeption) => {
          console.log(err);
        });
    } else if (commands[0] === "route") {
      if (commands[1] === "add") {
        executeAddRoute(commands.slice(2));
      } else console.log(`sub command "add"`);
    } else {
      console.log("><");
    }
  });

  const app = new oak.Application();
  if (projectSettings.origins) {
    app.use(oakCors({ origin: projectSettings.origins, credentials: true }));
  }

  const router = new oak.Router();
  router.use("/ebina", ebinaRouter.routes());
  app.use(router.routes(), router.allowedMethods());
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

  startCrons();

  Deno.addSignalListener("SIGTERM", () => {
    renewCron.stop();
    exitHonbu();
  });
});
