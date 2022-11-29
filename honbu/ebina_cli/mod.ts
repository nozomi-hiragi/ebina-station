import { CLI, Command, OnExecute } from "../cli.ts";
import { createCertbotCommand } from "./certbot.ts";
import { createMemeberCommand } from "./member.ts";
import { createRouteCommand } from "./route.ts";

export const startEbinaCLI = (onExit: OnExecute) =>
  new CLI(new Command("q", onExit), [
    createMemeberCommand(),
    createCertbotCommand(),
    createRouteCommand(),
  ]).start();
