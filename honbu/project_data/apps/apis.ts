import { APPS_DIR } from "../mod.ts";
import { isExist } from "../../utils/utils.ts";

const APIS_JSON_FILE_NAME = "apis.json";

interface APIItemValues {
  name: string;
  method: "get" | "head" | "post" | "put" | "delete" | "options" | "patch";
  type: "static" | "JavaScript";
  value: string;
}

interface APIValues {
  port: number;
  apis: { [path: string]: APIItemValues | undefined };
}

export class APIItem {
  values: APIItemValues;
  constructor(values: APIItemValues) {
    this.values = values;
  }

  getRawValues = () => this.values;
}

export class APIs {
  private jsonPath: string;
  private port = 1234;
  private apis: { [name: string]: APIItem | undefined } = {};

  constructor(appName: string) {
    this.jsonPath = `${APPS_DIR}/${appName}/${APIS_JSON_FILE_NAME}`;
    if (isExist(this.jsonPath)) {
      const values: APIValues = JSON.parse(
        Deno.readTextFileSync(this.jsonPath),
      );
      this.port = values.port;
      for (const name of Object.keys(values.apis)) {
        this.apis[name] = new APIItem(values.apis[name]!);
      }
    } else {
      this.saveAPIsToFile();
    }
  }

  private saveAPIsToFile() {
    const values: APIValues = { apis: {}, port: this.port };
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

  public getAPI(path: string) {
    return this.apis[path];
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

  public getPort() {
    return this.port;
  }

  public setPort(port: number) {
    this.port = port;
    this.saveAPIsToFile();
  }
}
