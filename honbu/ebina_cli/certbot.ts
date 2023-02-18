import { certCertbot, renewCertbot } from "../action_delegate/certbot.ts";
import { Command, CommandOption, OptionValue } from "../cli.ts";
import { logConsole, logger } from "../utils/log.ts";
import { RunCommandException } from "../utils/utils.ts";

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
    logConsole.info("...");
    certCertbot(args.domain, args.email).then((ret) => {
      logConsole.info(ret.output);
    }).catch((err: RunCommandException) => {
      logger.error("certbot error:", err);
    }).finally(() => {
      logConsole.info("finish.");
    });
  } else {
    logConsole.info("no domain arg");
  }
};

const executeRenew = () => {
  logConsole.info("...");
  renewCertbot().then((ret) => {
    logConsole.info(ret.output);
  }).catch((err: RunCommandException) => {
    logger.error("renew error:", err);
  }).finally(() => {
    logConsole.info("finish.");
  });
};

export const createCertbotCommand = () =>
  new Command("certbot", (options) => {
    const sc = options[0];
    if (!sc) return logConsole.info("no sub command");
    switch (sc.option) {
      case "certonly":
        executeCertonly(options);
        break;
      case "renew":
        executeRenew();
        break;
      default:
        logConsole.info("wrong sub command");
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
