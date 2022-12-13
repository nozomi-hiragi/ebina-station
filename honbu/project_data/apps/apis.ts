import { APPS_DIR } from "../mod.ts";
import { isExist } from "../../utils/utils.ts";
import { getNextPort, setPort } from "./ports.ts";
import { logEbina } from "../../utils/log.ts";

const APIS_JSON_FILE_NAME = "apis.json";

interface APIItemValuesV1 {
  name: string;
  method: "get" | "head" | "post" | "put" | "delete" | "options" | "patch";
  type: "static" | "JavaScript";
  value: string;
}

interface APIItemValuesV2 {
  name: string;
  method: "get" | "head" | "post" | "put" | "delete" | "options" | "patch";
  filename?: string;
  value: string;
}

interface APIValuesV1 {
  port: number;
  apis: { [path: string]: APIItemValuesV1 | undefined };
}

interface APIValuesV2 {
  version: 2;
  apis: { [path: string]: APIItemValuesV2 | undefined };
}

const CURRENT_VERSION = 2;

const migrateV1toV2 = (appName: string, json: APIValuesV1): APIValuesV2 => {
  if (!setPort(appName, json.port)) {
    const port = getNextPort();
    if (!setPort(appName, port)) {
      logEbina.error(`migrage port error:`, appName, port);
    }
  }
  const result: APIValuesV2 = { version: 2, apis: {} };
  Object.keys(json.apis).forEach((path) => {
    const { type, ...it } = json.apis[path]!;
    if (type === "JavaScript") {
      const args = it.value.split(">");
      result.apis[path] = {
        ...it,
        filename: args[0],
        value: args[1],
      };
    } else {
      result.apis[path] = it;
    }
  });
  return result;
};

export class APIItem {
  values: APIItemValuesV2;
  constructor(values: APIItemValuesV2) {
    this.values = values;
  }

  getRawValues = () => this.values;
}

export class APIs {
  private jsonPath: string;
  private apis: { [name: string]: APIItem | undefined } = {};

  constructor(appName: string) {
    this.jsonPath = `${APPS_DIR}/${appName}/${APIS_JSON_FILE_NAME}`;
    if (isExist(this.jsonPath)) {
      const json = JSON.parse(
        Deno.readTextFileSync(this.jsonPath),
      );
      const version: number = json.version ?? 1;
      let values: APIValuesV2;
      switch (version) {
        default:
          throw new Error(`wrong version ${appName}`);
        case 1:
          values = migrateV1toV2(appName, json);
          Deno.writeTextFileSync(
            this.jsonPath,
            JSON.stringify(values, undefined, 2),
          );
          break;
        case 2:
          values = json;
          break;
      }
      for (const name of Object.keys(values.apis)) {
        this.apis[name] = new APIItem(values.apis[name]!);
      }
    } else {
      this.saveAPIsToFile();
    }
  }

  private saveAPIsToFile() {
    const values: APIValuesV2 = { version: 2, apis: {} };
    for (const name of Object.keys(this.apis)) {
      values.apis[name] = this.apis[name]?.getRawValues();
    }
    Deno.writeTextFileSync(
      this.jsonPath,
      JSON.stringify(values, undefined, 2),
    );
  }

  public getAPIItemValueList() {
    return Object.keys(this.apis)
      .map((path) => ({ path, api: this.apis[path]!.getRawValues() }));
  }

  private getAPI(path: string) {
    return this.apis[path];
  }

  public getAPIValue(path: string) {
    const api = this.getAPI(path);
    if (!api) return undefined;
    return { version: CURRENT_VERSION, ...api.getRawValues() };
  }

  public setAPI(path: string, api: APIItem) {
    this.apis[path] = api;
    this.saveAPIsToFile();
  }

  public deleteAPI(path: string) {
    if (!this.getAPI(path)) return false;
    delete this.apis[path];
    this.saveAPIsToFile();
    return true;
  }
}
