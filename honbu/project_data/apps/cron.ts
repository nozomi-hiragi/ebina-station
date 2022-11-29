import { Cron } from "../../deps.ts";
import { APPS_DIR } from "../mod.ts";

const CRON_JSON_FILE_NAME = "cron.json";

interface CronItemVales {
  enable: boolean;
  pattern: string;
  function: string;
}

type CronValues = {
  [name: string]: CronItemVales | undefined;
};

export class CronItem {
  appName: string;
  values: CronItemVales;

  filename!: string;
  funcname!: string;
  private cron?: Cron;

  constructor(appName: string, values: CronItemVales) {
    this.appName = appName;
    this.values = values;
    this.setFunctionStr(values.function);
  }

  getRawValues = () => this.values;

  setEnable(enable: boolean) {
    this.values.enable = enable;
  }
  getEnable() {
    return this.values.enable;
  }

  setPattern(pattern: string) {
    this.values.pattern = pattern;
  }
  getPattern() {
    return this.values.pattern;
  }

  applyFunctionNames() {
    this.values.function = `${this.filename}>${this.funcname}`;
  }

  setFileName(name: string) {
    this.filename = name;
    this.applyFunctionNames();
  }
  getFileName() {
    return this.filename;
  }

  setFuncName(name: string) {
    this.funcname = name;
    this.applyFunctionNames();
  }
  getFuncName() {
    return this.funcname;
  }

  setFunctionStr(str: string) {
    this.values.function = str;
    const fncSpl = this.values.function.split(">");
    this.filename = fncSpl[0];
    this.funcname = fncSpl[1];
  }
  getFunctionStr() {
    return this.values.function;
  }

  async start() {
    if (this.cron) return false;

    const filename = this.getFileName();
    const funcName = this.getFuncName();
    const modelPath = `../../.${APPS_DIR}/${this.appName}/scripts/${filename}`;

    try {
      const module = await import(modelPath);
      if (!Object.keys(module).includes(funcName)) {
        console.log("no value in module", funcName);
        return false;
      }

      this.cron = new Cron(this.getPattern(), () => {
        const ret = module[funcName]() as string;
        console.log(`${this.appName}:${filename}:${funcName}: ${ret}`);
      });
    } catch (err) {
      console.log(err);
      return false;
    }
    return true;
  }

  stop() {
    if (!this.cron) return false;
    this.cron.stop();
    this.cron = undefined;
    return true;
  }
}

export class CronItems {
  private appName: string;
  private jsonPath: string;

  items: { [name: string]: CronItem | undefined } = {};

  constructor(appName: string) {
    this.appName = appName;
    this.jsonPath = `${APPS_DIR}/${this.appName}/${CRON_JSON_FILE_NAME}`;
    try {
      const values = JSON.parse(
        Deno.readTextFileSync(this.jsonPath),
      ) as CronValues;
      for (const name of Object.keys(values)) {
        this.items[name] = new CronItem(appName, values[name]!);
      }
    } catch {
      this.save();
    }
  }

  save() {
    try {
      const values: CronValues = {};
      for (const name of Object.keys(this.items)) {
        values[name] = this.items[name]?.getRawValues();
      }
      Deno.writeTextFileSync(
        this.jsonPath,
        JSON.stringify(values, undefined, 2),
      );
      return true;
    } catch (err) {
      console.log(err);
      return false;
    }
  }

  setItem(name: string, item?: CronItem) {
    if (item) {
      this.items[name] = item;
      return true;
    } else if (this.getItem(name)) {
      delete this.items[name];
      return true;
    } else {
      return false;
    }
  }
  getItem(name: string) {
    return this.items[name];
  }

  getItemNames() {
    return Object.keys(this.items);
  }

  switchCron(cronName: string, enable: boolean) {
    const cronItem = this.getItem(cronName);
    if (!cronItem) return false;
    cronItem.stop();

    cronItem.setEnable(enable);
    if (enable) cronItem.start();
    this.save();

    return true;
  }

  setCron(cronName: string, cronItem: CronItem | undefined) {
    const currenItem = this.getItem(cronName);
    if (currenItem) currenItem.stop();

    this.setItem(cronName, cronItem);
    if (cronItem && cronItem.getEnable()) {
      cronItem.start();
    }
    this.save();
  }

  startAll() {
    for (const it of Object.values(this.items)) {
      if (it?.getEnable()) it?.start();
    }
  }
}
