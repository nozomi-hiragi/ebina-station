import { certCertbot, renewCertbot } from "../action_delegate/certbot.ts";
import { Command, CommandOption, OptionValue } from "../cli.ts";
import { RunCommandExeption } from "../utils/utils.ts";

const executeCertonly = (options: OptionValue[]) => {
  const args: { domain?: string; email?: string } = {};
  for (const op of options) {
    if (op.option === "DOMAIN") {
      args.domain = op.value;
    } else if (op.option === "EMAIL") {
      args.email = op.value;
    }
  }
  if (args.domain) {
    console.log("...");
    certCertbot(args.domain, args.email).then((ret) => {
      console.log(ret.output);
    }).catch((err: RunCommandExeption) => {
      console.log(err);
    }).finally(() => {
      console.log("finish.");
    });
  } else {
    console.log("no domain arg");
  }
};

const executeRenew = () => {
  console.log("...");
  renewCertbot().then((ret) => {
    console.log(ret.output);
  }).catch((err: RunCommandExeption) => {
    console.log(err);
  }).finally(() => {
    console.log("finish.");
  });
};

export const createCertbotCommand = () =>
  new Command("certbot", (options) => {
    const sc = options[0];
    if (!sc) return console.log("no sub command");
    switch (sc.option) {
      case "certonly":
        executeCertonly(options);
        break;
      case "renew":
        executeRenew();
        break;
      default:
        console.log("wrong sub command");
    }
  }, {
    options: [
      new CommandOption("certonly"),
      new CommandOption("renew"),
      new CommandOption("DOMAIN", {
        alias: ["--domains", "-d"],
        takeValue: true,
      }),
      new CommandOption("EMAIL", {
        alias: ["--email", "-m"],
        takeValue: true,
      }),
    ],
  });
