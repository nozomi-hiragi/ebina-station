import { restartService, runService } from "./DockerComposeController.ts";
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
  let agree = false;
  const domains: string[] = [];
  let email = "";
  let state: "none" | "domain" | "email" = "none";
  for (let i = 0; i < certonlyArgs.length; i++) {
    const it = certonlyArgs[i];
    switch (state) {
      case "none":
        if (it === "--agree-tos") agree = true;
        else if (it === "-d") state = "domain";
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
    agree ? "--agree-tos" : "",
    email ? `-m ${email}` : "--register-unsafely-without-email",
    "--webroot",
    "-w",
    "/var/www/html",
    ...domains,
    ...tmpCmd,
  ].filter(Boolean);
};

export const runCertbotService = (commands: string[]) =>
  runService("certbot", createCertbotCmd(commands.slice(1)));

// ========== Route ==========

export const executeAddRoute = (api: KoujouAPI, routeArgs: string[]) => {
  const { restart, ...route } = parseRoute(routeArgs);
  if (!route.name) return console.log("name is required");
  if (!route.hostname) return console.log("hostname is required");
  if (!route.port || Number.isNaN(route.port)) {
    return console.log("port is required");
  }

  api.addRoute(route).then((ret) => {
    switch (ret) {
      case 201:
        break;
      case 400:
        console.log("wrong params");
        break;
      case 409:
        console.log("this name is already used");
        break;
    }
  }).then(() => {
    if (restart) {
      generateNginxConfsFromJson();
      restartService(ServiceName.Jinji).catch((msg) => console.log(msg));
    }
  });
};

const parseRoute = (routeArgs: string[]) => {
  let name = "";
  let hostname = "";
  let port: number | "koujou" = 0;
  let restart = false;
  let state: "none" | "name" | "hostname" | "port" = "none";
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
    }
  }
  return { name, hostname, port, restart };
};
