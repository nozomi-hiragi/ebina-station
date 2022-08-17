import { Cron } from "../deps.ts";
import { APPS_DIR } from "../ebinaAPI/app/index.ts";

export type CronItem = {
  enable: boolean;
  pattern: string;
  function: string;
};

type CronJson = {
  [name: string]: CronItem | undefined;
};

const CRON_JSON_FILE_NAME = `cron.json`;

const cronJsons: { [name: string]: CronJson | undefined } = {};
// deno-lint-ignore no-explicit-any
const modules: { [name: string]: any } = {};
const crons: { [name: string]: Cron | undefined } = {};

const initCronJson = (appName: string) => {
  try {
    const filepath = `${APPS_DIR}/${appName}/${CRON_JSON_FILE_NAME}`;
    return JSON.parse(Deno.readTextFileSync(filepath)) as CronJson;
  } catch (_) {
    return {} as CronJson;
  }
};

export const getCronJson = (appName: string) =>
  cronJsons[appName] ?? (cronJsons[appName] = initCronJson(appName));

export const saveCronJson = (appName: string, cronJson: CronJson) => {
  cronJsons[appName] = cronJson;
  const filepath = `${APPS_DIR}/${appName}/${CRON_JSON_FILE_NAME}`;
  Deno.writeTextFileSync(filepath, JSON.stringify(cronJson, undefined, 2));
};

export const switchCron = async (
  appName: string,
  cronName: string,
  on: boolean,
) => {
  const cron = crons[`${appName}/${cronName}`];
  if (cron) {
    cron.stop();
    crons[`${appName}/${cronName}`] = undefined;
  }

  const cronJson = getCronJson(appName);
  const cronItem = cronJson[cronName];
  if (!cronItem) {
    console.log("no cron item");
    return false;
  }

  if (on) {
    const args = cronItem.function.split(">");
    const modelPath = `../${APPS_DIR}/${appName}/scripts/${args[0]}`;
    let module = modules[modelPath];
    try {
      if (!module) module = await import(modelPath);
      if (!Object.keys(module).includes(args[1])) {
        console.log("no value in module", args[1]);
        return false;
      }
      crons[`${appName}/${cronName}`] = new Cron(cronItem.pattern, () => {
        const ret = module[args[1]]() as string;
        console.log(`${appName}/${cronName}: ${ret}`);
      });
    } catch (err) {
      console.log(err);
      return false;
    }
  }

  cronItem.enable = on;
  cronJson[cronName] = cronItem;
  saveCronJson(appName, cronJson);

  return true;
};

export const setCron = async (
  appName: string,
  cronName: string,
  cronItem: CronItem | undefined,
) => {
  const cronJson = getCronJson(appName);
  cronJson[cronName] = cronItem;
  cronJsons[appName] = cronJson;

  return await switchCron(appName, cronName, cronItem?.enable ?? false)
    .then((ret) => {
      if (cronItem === undefined) {
        delete cronJson[cronName];
        saveCronJson(appName, cronJson);
        return true;
      }
      if (!ret) {
        cronJson[cronName] = undefined;
        cronJsons[appName] = cronJson;
      }
      return ret;
    });
};

export const startCrons = () => {
  try {
    for (const dir of Deno.readDirSync(APPS_DIR)) {
      if (!dir.isDirectory) continue;
      const appName = dir.name;
      const cronJson = getCronJson(appName);
      Object.keys(cronJson).forEach((cronName) => {
        const cronItem = cronJson[cronName];
        if (!cronItem) return;
        setCron(appName, cronName, cronItem).then((isOk) => {
          if (isOk) return;
          console.log(`error cron load ${appName}/${cronName}`);
        });
      });
    }
  } catch (err) {
    console.log(err.message);
  }
};
