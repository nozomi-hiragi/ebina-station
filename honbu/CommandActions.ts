import { execDCCRestart, execDCCRun } from "./docker/DockerComposeCommand.ts";
import { ServiceName } from "./EbinaService.ts";
import { generateNginxConfsFromJson } from "./honbuAPI.ts";
import { KoujouAPI } from "./KoujouAPI.ts";

/// ========== Member ==========
export class MemberTempActions {
  static showTempMemberList = (api: KoujouAPI) =>
    api.getTempMemberList().then((ret) => console.log(ret));

  static admitTempMember = (api: KoujouAPI, id: string) =>
    api.admitTempMember(id).then((ret) => {
      switch (ret) {
        case 200:
          console.log("ok");
          break;
        case 400:
        case 404:
        default:
          console.log("wrong id");
          break;
        case 409:
          console.log("this id is already used");
          break;
      }
    });

  static denyTempMember = (api: KoujouAPI, id: string) =>
    api.denyTempMember(id).then((ret) => {
      switch (ret) {
        case 200:
          console.log("ok");
          break;
        case 400:
        case 404:
        default:
          console.log("wrong id");
          break;
      }
    });

  static actionst: {
    [name: string]: (api: KoujouAPI, id: string) => Promise<void>;
  } = {
    "list": async (api: KoujouAPI) => await this.showTempMemberList(api),
    "admit": async (api: KoujouAPI, id: string) => {
      if (id) await this.admitTempMember(api, id);
      else console.log("id is required");
    },
    "deny": async (api: KoujouAPI, id: string) => {
      if (id) await this.denyTempMember(api, id);
      else console.log("id is required");
    },
  };
}

/// ========== Certbot ==========

const createCertbotCmd = (certbotArgs: string[]) => {
  switch (certbotArgs[0]) {
    case "certonly": {
      return createCertonlyCommand(certbotArgs.slice(1));
    }
    case "renew":
      return ["renew"];
    default:
      return certbotArgs;
  }
};

const createCertonlyCommand = (certonlyArgs: string[]) => {
  const tmpCmd: string[] = [];
  const domains: string[] = [];
  let email = "";
  let state: "none" | "domain" | "email" = "none";
  for (let i = 0; i < certonlyArgs.length; i++) {
    const it = certonlyArgs[i];
    switch (state) {
      case "none":
        if (it === "-d") state = "domain";
        else if (it === "-m") state = "email";
        else tmpCmd.push(it);
        break;
      case "domain":
        domains.push(`-d ${it}`);
        state = "none";
        break;
      case "email":
        email = it;
        state = "none";
        break;
    }
  }
  return [
    "certonly",
    "-n",
    "--agree-tos", // プロジェクト作成時に同意を得てる
    email ? `-m ${email}` : "--register-unsafely-without-email",
    "--webroot",
    "-w",
    "/var/www/html",
    ...domains,
    ...tmpCmd,
  ].filter(Boolean);
};

export const runCertbotService = (commands: string[]) =>
  execDCCRun("certbot", createCertbotCmd(commands.slice(1)));

// ========== Route ==========

export const executeAddRoute = (
  isDesktop: boolean,
  api: KoujouAPI,
  routeArgs: string[],
) => {
  const { name, restart, certbot, email, ...route } = parseRoute(routeArgs);
  if (!name) return console.log("name is required");
  if (!route.hostname) return console.log("hostname is required");
  if (!route.port || Number.isNaN(route.port)) {
    return console.log("port is required");
  }

  api.addRoute(name, { certWebRoot: certbot, ...route }).then((ret) => {
    console.log("Route added");
    switch (ret) {
      case 201:
        return true;
      case 400:
        console.log("wrong params");
        return true;
      case 409:
        console.log("this name is already used");
        return false;
    }
  }).then(async (ret) => {
    if (ret && (restart || certbot)) {
      console.log("Restart Jinji");
      generateNginxConfsFromJson(isDesktop);
      await execDCCRestart(ServiceName.Jinji);
      if (certbot) {
        const certCmd = ["certbot", "certonly", "-d", route.hostname];
        if (email) certCmd.push("-m", email);
        console.log("Start certbot...");
        const ret = await runCertbotService(certCmd);
        console.log(`result: ${ret.status.success}`);
        if (ret.status.success) {
          await api.setRoute(name, {
            certbot: true,
            certWebRoot: true,
            ...route,
          });
          await execDCCRestart(ServiceName.Jinji);
        }
      }
    }
  }).catch((msg) => console.log(msg));
};

const parseRoute = (routeArgs: string[]) => {
  let name = "";
  let hostname = "";
  let port: number | "koujou" = 0;
  let restart = false;
  let certbot = false;
  let email = "";
  let state: "none" | "name" | "hostname" | "port" | "email" = "none";
  for (let i = 0; i < routeArgs.length; i++) {
    const it = routeArgs[i];
    switch (state) {
      case "none":
        switch (it) {
          case "-h":
          case "--hostname":
            state = "hostname";
            break;
          case "-p":
          case "--port":
            state = "port";
            break;
          case "-r":
          case "--restart":
            restart = true;
            break;
          case "-c":
          case "--certbot":
            certbot = true;
            break;
          case "-m":
            state = "email";
            break;
          default:
            name = it;
        }
        break;
      case "hostname":
        hostname = it;
        state = "none";
        break;
      case "port":
        port = it === "koujou" ? "koujou" : Number(it);
        state = "none";
        break;
      case "email":
        email = it;
        state = "none";
        break;
    }
  }
  return { name, hostname, port, restart, certbot, email };
};
