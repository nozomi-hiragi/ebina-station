import { logEbina } from "../../utils/log.ts";
import { mkdirIfNotExist } from "../../utils/utils.ts";
import { APPS_DIR, GOMI_DIR } from "../mod.ts";
import { APIs } from "./apis.ts";
import { CronItems } from "./cron.ts";
import { initPorts } from "./ports.ts";
import { Scripts } from "./scripts.ts";

const FIRST_APP_NAME = "FirstApp";

const apps: { [name: string]: App | undefined } = {};

export const getApp = (appName: string) => {
  return apps[appName];
};

export const changeAppName = (prev: string, name: string) => {
  const app = apps[prev];
  if (!app) return false;
  if (apps[name]) return false;
  try {
    Deno.renameSync(`${APPS_DIR}/${prev}`, `${APPS_DIR}/${name}`);
  } catch (err) {
    logEbina.error("Change app name error", err.toString());
    return false;
  }
  delete apps[prev];
  app.appName = name;
  apps[name] = app;
  return true;
};

class App {
  appName: string;
  cron: CronItems;
  apis: APIs;
  scripts: Scripts;

  constructor(appName: string) {
    this.appName = appName;
    this.cron = new CronItems(appName);
    this.apis = new APIs(appName);
    this.scripts = new Scripts(appName);
  }
}

export const initApps = () => {
  try {
    for (const dir of Deno.readDirSync(APPS_DIR)) {
      if (!dir.isDirectory) continue;
      const appName = dir.name;
      loadApp(appName);
    }
  } catch {
    Deno.mkdirSync(APPS_DIR, { recursive: true });
  }
  if (getAppNameList().length === 0) {
    createApp(FIRST_APP_NAME);
  }
  initPorts(getAppNameList());
};

const loadApp = (appName: string) => {
  const app = new App(appName);
  apps[appName] = app;
  app.cron.startAll();
};

export const createApp = (appName: string) => {
  if (mkdirIfNotExist(`${APPS_DIR}/${appName}`) === undefined) {
    loadApp(appName);
    return true;
  } else {
    return false;
  }
};

export const deleteApp = (appName: string) => {
  mkdirIfNotExist(GOMI_DIR);
  try {
    Deno.renameSync(`${APPS_DIR}/${appName}`, `${GOMI_DIR}/${appName}`);
    delete apps[appName];
    return true;
  } catch (err) {
    logEbina.error(`delete app ${appName} error:`, err);
    return false;
  }
};

export const getAppNameList = () => Object.keys(apps);
