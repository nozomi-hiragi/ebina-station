import { APPS_DIR } from "../mod.ts";
import { isExist } from "../../utils/utils.ts";

export type APIType = {
  name: string;
  method: "get" | "head" | "post" | "put" | "delete" | "options" | "patch";
  type: "static" | "JavaScript";
  value: string;
};

export type APIsType = {
  port: number;
  apis: { [path: string]: APIType | undefined };
};

export class APIs {
  private jsonPath: string;
  private apis: APIsType;

  constructor(appName: string) {
    this.jsonPath = `${APPS_DIR}/${appName}/apis.json`;
    if (isExist(this.jsonPath)) {
      this.apis = JSON.parse(Deno.readTextFileSync(this.jsonPath));
    } else {
      this.apis = { apis: {}, port: 1234 };
      this.saveAPIsToFile();
    }
  }

  private saveAPIsToFile() {
    if (!this.jsonPath) return;
    Deno.writeTextFileSync(
      this.jsonPath,
      JSON.stringify(this.apis, undefined, 2),
    );
  }

  public getAPIs() {
    return this.apis.apis;
  }

  public getAPI(path: string) {
    return this.apis.apis[path];
  }

  public setAPI(path: string, api: APIType) {
    this.apis.apis[path] = api;
    this.saveAPIsToFile();
  }

  public deleteAPI(path: string) {
    if (!this.apis.apis[path]) return false;
    delete this.apis.apis[path];
    this.saveAPIsToFile();
    return true;
  }

  public getPort() {
    return this.apis.port;
  }

  public setPort(port: number) {
    this.apis.port = port;
    this.saveAPIsToFile();
  }
}
