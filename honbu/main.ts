import * as oak from "https://deno.land/x/oak@v10.6.0/mod.ts";
import { isExist, readReader } from "./utils.ts";
import { crypto } from "https://deno.land/std@0.152.0/crypto/mod.ts";
import { rmService, upService } from "./DockerComposeController.ts";
import { initDockerComposeFile, ServiceName } from "./EbinaService.ts";
import { createHonbuRouter } from "./honbuAPI.ts";
import { getSettings, PROJECT_PATH } from "../koujou/settings/settings.ts";

const pjInfo = isExist(PROJECT_PATH);
if (pjInfo) {
  if (!pjInfo.isDirectory) throw new Error("project is not directory");
} else {
  Deno.mkdir(PROJECT_PATH, { recursive: true });
}

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
  const projectSettings = getSettings();
  const mongoSettings = projectSettings.mongodb;
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

  readReader(Deno.stdin, (msg: string) => {
    if (msg === "q") {
      exitHonbu();
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

  const app = new oak.Application();
  const honbuRouter = createHonbuRouter(honbuKey);
  app.use(honbuRouter.routes(), honbuRouter.allowedMethods());
  app.listen({ port: honbuPort });
};

main();

Deno.addSignalListener("SIGTERM", () => exitHonbu());
