import { runService } from "./DockerComposeController.ts";

/// ========== Member ==========
export class MemberTempActions {
  honbuKey: string;
  koujouPort: number;

  constructor(honbuKey: string, koujouPort: number) {
    this.honbuKey = honbuKey;
    this.koujouPort = koujouPort;
  }

  showTempMemberList = () =>
    fetch(`http://${"localhost"}:${this.koujouPort}/honbu/member/temp/list`, {
      method: "GET",
      headers: { key: this.honbuKey },
    }).then((ret) => ret.json())
      .then((ret) => console.log(ret));

  admitTempMember = (id: string) =>
    fetch(
      `http://${"localhost"}:${this.koujouPort}/honbu/member/temp/admit`,
      {
        method: "POST",
        body: JSON.stringify({ id }),
        headers: { key: this.honbuKey },
      },
    ).then((ret) => {
      switch (ret.status) {
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

  denyTempMember = (id: string) =>
    fetch(`http://${"localhost"}:${this.koujouPort}/honbu/member/temp/deny`, {
      method: "POST",
      body: JSON.stringify({ id }),
      headers: { key: this.honbuKey },
    }).then((ret) => {
      switch (ret.status) {
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

  actionst: { [name: string]: (id: string) => Promise<void> } = {
    "list": async () => await this.showTempMemberList(),
    "admit": async (id: string) => {
      if (id) await this.admitTempMember(id);
      else console.log("id is required");
    },
    "deny": async (id: string) => {
      if (id) await this.denyTempMember(id);
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
