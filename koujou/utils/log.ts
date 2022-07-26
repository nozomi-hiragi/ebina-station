import { log } from "../deps.ts";

await log.setup({
  handlers: {
    Ebina: new log.handlers.FileHandler("INFO", {
      filename: "./logs/ebina.log",
      formatter: "{levelName} {msg}",
      mode: "w",
    }),
    EbinaAPI: new log.handlers.FileHandler("INFO", {
      filename: "./logs/ebinaAPI.log",
      formatter: "{levelName} {msg}",
      mode: "w",
    }),
    console: new log.handlers.ConsoleHandler("INFO"),
  },
  loggers: {
    default: {
      level: "INFO",
      handlers: ["Ebina", "console"],
    },
    Koujou: {
      level: "INFO",
      handlers: ["Ebina", "console"],
    },
    API: {
      level: "INFO",
      handlers: ["EbinaAPI", "console"],
    },
  },
});

export const logKoujou = log.getLogger("Koujou");
export const logApi = log.getLogger("API");
