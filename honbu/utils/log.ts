import { datetime, log, TypeUtils } from "../deps.ts";
import { mkdirIfNotExist } from "./utils.ts";

const parseArgs = (args: unknown[]) =>
  args.map((arg) => {
    if (TypeUtils.isString(arg)) return arg;
    if (TypeUtils.isObject(arg)) return JSON.stringify(arg);
    return String(arg);
  }).join(", ");

const formatDate = (date: Date) => datetime.format(date, "yyyy/MM/dd HH:mm:ss");

mkdirIfNotExist("./logs");
log.setup({
  handlers: {
    Ebina: new log.handlers.FileHandler("INFO", {
      filename: "./logs/ebina.log",
      formatter: (r) =>
        formatDate(r.datetime) +
        ` [${r.levelName}] ${r.msg} ${parseArgs(r.args)}`.trimEnd(),
    }),
    console: new log.handlers.ConsoleHandler("DEBUG", {
      formatter: (r) => `${r.msg} ${parseArgs(r.args)}`.trimEnd(),
    }),
  },
  loggers: {
    default: { level: "DEBUG", handlers: ["Ebina", "console"] },
    console: { level: "DEBUG", handlers: ["console"] },
    ebina: { level: "INFO", handlers: ["Ebina"] },
  },
});

export const logger = log.getLogger();
export const logEbina = log.getLogger("ebina");
export const logConsole = log.getLogger("console");
