import { APPS_DIR } from "../mod.ts";
import { CronItems } from "./cron.ts";

const apps: { [name: string]: App | undefined } = {};

export const getApp = (appName: string) => {
  return apps[appName];
};

class App {
  appName: string;
  cron: CronItems;

  constructor(appName: string) {
    this.appName = appName;
    this.cron = new CronItems(appName);
  }
}

export const initApps = () => {
  try {
    for (const dir of Deno.readDirSync(APPS_DIR)) {
      if (!dir.isDirectory) continue;
      const appName = dir.name;
      const app = new App(appName);
      apps[appName] = app;
      app.cron.startAll();
    }
  } catch (err) {
    console.log(err);
  }
};
