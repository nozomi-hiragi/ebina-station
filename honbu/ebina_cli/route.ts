import { certCertbot } from "../action_delegate/certbot.ts";
import { Command, CommandOption } from "../cli.ts";
import { execDCCRestart } from "../docker/DockerComposeCommand.ts";
import { ServiceName } from "../ebina_docker_compose.ts";
import {
  generateNginxConfsFromJson,
  NginxConfs,
} from "../project_data/nginx.ts";
import { logConsole } from "../utils/log.ts";

const executeAddRoute = (
  name: string,
  hostname: string,
  port: number | "koujou",
  restart?: boolean,
  certbot?: boolean,
  email?: string,
) => {
  const nginxConfs = NginxConfs.instance();
  if (nginxConfs.getConf(name)) {
    logConsole.info("this name is already used");
    return;
  }
  nginxConfs.setConf(name, { hostname, port, certWebRoot: certbot });
  if (restart || certbot) {
    logConsole.info("Restart Jinji");
    generateNginxConfsFromJson();
    execDCCRestart(ServiceName.Jinji).then(async () => {
      if (certbot) {
        logConsole.info("Start certbot...");
        const ret = await certCertbot(hostname, email);
        logConsole.info(`result: ${ret.status.success}`);
        if (ret.status.success) {
          nginxConfs.setConf(name, {
            hostname,
            port,
            certbot: true,
            certWebRoot: true,
          });
          await execDCCRestart(ServiceName.Jinji);
        }
      }
    }).catch((err) => logConsole.error(err));
  }
};

export const createRouteCommand = () =>
  new Command("route", (options) => {
    const sc = options[0];
    if (!sc) return logConsole.info("no sub command");
    if (sc.option === "add") {
      const name = sc.option;
      if (!name) return logConsole.info("name is required");

      const args: {
        port?: number | "koujou";
        email?: string;
        hostname?: string;
        restart?: boolean;
        certbot?: boolean;
      } = {};

      for (const it of options) {
        switch (it.option) {
          case "--port":
            args.port = it.value === "koujou" ? "koujou" : Number(it.value);
            break;
          case "--email":
            args.email = it.value;
            break;
          case "--hostname":
            args.hostname = it.value;
            break;
          case "--restart":
            args.restart = true;
            break;
          case "--certbot":
            args.certbot = true;
            break;
        }
      }

      if (!args.hostname) return logConsole.info("hostname is required");
      if (!args.port || Number.isNaN(args.port)) {
        return logConsole.info("port is required");
      }

      executeAddRoute(
        name,
        args.hostname,
        args.port,
        args.restart,
        args.certbot,
        args.email,
      );
    } else logConsole.info(`sub command "add"`);
  }, {
    options: [
      new CommandOption("add", { takeValue: true }),
      new CommandOption("--port", { alias: ["-p"], takeValue: true }),
      new CommandOption("--email", { alias: ["-m"], takeValue: true }),
      new CommandOption("--hostname", { alias: ["-h"], takeValue: true }),
      new CommandOption("--restart", { alias: ["-r"] }),
      new CommandOption("--certbot", { alias: ["-c"] }),
    ],
  });
