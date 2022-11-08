import { execDCCRestart, execDCCRun } from "./docker/DockerComposeCommand.ts";
import { ServiceName } from "./EbinaService.ts";
import { generateNginxConfsFromJson } from "./project_data/nginx.ts";
import { nginxConfs } from "./ebinaAPI/rouging/routing.ts";
import { Members } from "./project_data/members/mod.ts";

/// ========== Member ==========
export class MemberTempActions {
  static showTempMemberList = () => {
    const tempMembers = Members.instance().getTempMembers();
    const tempMemberArray = Object.keys(tempMembers)
      .map((id) => ({ id, ...tempMembers[id]?.getValue() }));
    console.log(tempMemberArray);
  };

  static admitTempMember = (id: string) => {
    switch (Members.instance().admitTempMember(id)) {
      case true:
        console.log("ok");
        break;
      case false:
        console.log("this id is already used");
        break;
      case undefined:
      default:
        console.log("wrong id");
        break;
    }
  };

  static denyTempMember = (id: string) => {
    if (Members.instance().denyTempMember(id)) {
      console.log("ok");
    } else {
      console.log("wrong id");
    }
  };

  static actionst: {
    [name: string]: (id: string) => void;
  } = {
    "list": () => this.showTempMemberList(),
    "admit": (id: string) => {
      if (id) this.admitTempMember(id);
      else console.log("id is required");
    },
    "deny": (id: string) => {
      if (id) this.denyTempMember(id);
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

export const executeAddRoute = (routeArgs: string[]) => {
  const { name, restart, certbot, email, ...route } = parseRoute(routeArgs);
  if (!name) return console.log("name is required");
  if (!route.hostname) return console.log("hostname is required");
  if (!route.port || Number.isNaN(route.port)) {
    return console.log("port is required");
  }

  if (nginxConfs.getConf(name)) {
    console.log("this name is already used");
    return;
  }
  nginxConfs.setConf(name, { certWebRoot: certbot, ...route });
  if (restart || certbot) {
    console.log("Restart Jinji");
    generateNginxConfsFromJson();
    execDCCRestart(ServiceName.Jinji).then(async () => {
      if (certbot) {
        const certCmd = ["certbot", "certonly", "-d", route.hostname];
        if (email) certCmd.push("-m", email);
        console.log("Start certbot...");
        const ret = await runCertbotService(certCmd);
        console.log(`result: ${ret.status.success}`);
        if (ret.status.success) {
          nginxConfs.setConf(name, {
            certbot: true,
            certWebRoot: true,
            ...route,
          });
          await execDCCRestart(ServiceName.Jinji);
        }
      }
    }).catch((err) => console.log(err));
  }
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
