import { Cron, oak } from "./deps.ts";
import { oakCors } from "./deps.ts";
import ebinaRouter from "./ebinaAPI/ebina.ts";
import {
  initDockerComposeFile,
  removeContainers,
  startContainers,
} from "./ebina_docker_compose.ts";
import { initProjectData } from "./project_data/mod.ts";
import { Settings } from "./project_data/settings/mod.ts";
import { startEbinaCLI } from "./ebina_cli/mod.ts";
import { renewCertbot } from "./action_delegate/certbot.ts";

const CERTBOT_RENEW_SCHEDULE = "0 0 22-28 * 1";

export class Service {
  private static _instance: Service;
  public static instance() {
    if (!this._instance) this._instance = new Service();
    return this._instance;
  }
  private constructor() {}

  private renewCron?: Cron;

  private startListen() {
    const projectSettings = Settings.instance();
    const app = new oak.Application();
    const router = new oak.Router().use("/ebina", ebinaRouter.routes());
    app.use(
      oakCors({ origin: projectSettings.origins, credentials: true }),
      router.routes(),
      router.allowedMethods(),
    ).listen({ port: projectSettings.getPortNumber() });
    console.log("start listeing");
  }

  async start() {
    await initProjectData()
      .then(() => initDockerComposeFile())
      .then(() => startContainers())
      .catch((err) => {
        console.log(err);
        this.exit(1);
      });

    startEbinaCLI(() => this.exit());
    this.startListen();

    this.renewCron = new Cron(CERTBOT_RENEW_SCHEDULE, () => {
      renewCertbot().then((ret) => {
        // @TODO ログに入れる
        console.log(`renew: ${ret}`);
      });
    });

    Deno.addSignalListener("SIGTERM", () => this.exit());
  }

  async exit(code?: number) {
    this.renewCron?.stop();
    await removeContainers().then((successes) => {
      if (!code) {
        const isFailed = successes.find((success) => !success);
        code = isFailed ? 1 : 0;
      }
      Deno.exit(code);
    });
  }
}
