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

export interface APIItemValuesV2 {
  name: string;
  path: string;
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
  apis: APIItemValuesV2[];
}

const CURRENT_VERSION = 2;

const migrateV1toV2 = (appName: string, json: APIValuesV1): APIValuesV2 => {
  if (!setPort(appName, json.port)) {
    const port = getNextPort();
    if (!setPort(appName, port)) {
      logEbina.error(`migrage port error:`, appName, port);
    }
  }
  const result: APIValuesV2 = { version: 2, apis: [] };
  Object.keys(json.apis).forEach((path) => {
    const { type, ...it } = json.apis[path]!;
    if (type === "JavaScript") {
      const args = it.value.split(">");
      result.apis.push({ ...it, path, filename: args[0], value: args[1] });
    } else {
      result.apis.push({ ...it, path });
    }
  });
  return result;
};

export class APIs {
  private jsonPath: string;
  private values: APIValuesV2 = { version: 2, apis: [] };

  constructor(appName: string) {
    this.jsonPath = `${APPS_DIR}/${appName}/${APIS_JSON_FILE_NAME}`;
    if (isExist(this.jsonPath)) {
      const json = JSON.parse(
        Deno.readTextFileSync(this.jsonPath),
      );
      const version: number = json.version ?? 1;
      switch (version) {
        default:
          throw new Error(`wrong version ${appName}`);
        case 1:
          this.values = migrateV1toV2(appName, json);
          this.saveAPIsToFile();
          break;
        case 2:
          this.values = json;
          break;
      }
    } else {
      this.saveAPIsToFile();
    }
  }

  private saveAPIsToFile() {
    Deno.writeTextFileSync(
      this.jsonPath,
      JSON.stringify(this.values, undefined, 2),
    );
  }

  public getAPIItemValueList() {
    return { version: CURRENT_VERSION, apis: this.values.apis };
  }

  private getAPI(path: string) {
    return this.values.apis.find((api) => api.path === path);
  }

  public getAPIValue(path: string) {
    const api = this.getAPI(path);
    if (!api) return undefined;
    return { version: CURRENT_VERSION, ...api };
  }

  private sortAPIS() {
    this.values.apis.sort((a, b) => {
      if (a.name === "") return 1;
      if (b.name === "") return -1;
      return a.name > b.name ? 1 : -1;
    });
  }

  public setAPI(path: string, api: APIItemValuesV2, save = true) {
    const find = this.values.apis.find((v, i, a) => {
      if (v.path !== path) return false;
      a[i] = api;
      return true;
    });
    if (!find) this.values.apis.push(api);
    this.sortAPIS();
    if (save) this.saveAPIsToFile();
  }

  public deleteAPI(path: string, save = true) {
    if (!this.getAPI(path)) return false;
    this.values.apis.find((v, i, a) => {
      if (v.path !== path) return false;
      a[i] = { path: "", name: "", method: "get", value: "" };
      return true;
    });
    this.sortAPIS();
    const target = this.values.apis.pop();
    if (target && target.name !== "") {
      this.values.apis.push(target);
      logEbina.error(`Delete API error`);
      return false;
    }
    if (save) this.saveAPIsToFile();
    return true;
  }

  public updateAPI(prevPath: string, api: APIItemValuesV2) {
    for (const it of this.values.apis) {
      if (it.path !== prevPath && it.name === api.name) return false;
    }
    this.setAPI(prevPath, api);
    return true;
  }
}
