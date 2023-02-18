import { isObject, isString } from "std/encoding/_yaml/utils.ts";
import * as datetime from "std/datetime/mod.ts";
import * as log from "std/log/mod.ts";
import { mkdirIfNotExist } from "./utils.ts";

const parseArgs = (args: unknown[]) =>
  args.map((arg) => {
    if (isString(arg)) return arg;
    if (isObject(arg)) return JSON.stringify(arg);
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
