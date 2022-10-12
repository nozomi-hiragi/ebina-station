import { NGINX_DIR } from "./settings.ts";
import { exist } from "../utils/utils.ts";

export type NginxConf = {
  hostname: string;
  port: number;
  www?: boolean;
};

type NginxConfJson = {
  [name: string]: NginxConf | undefined;
};

export class NginxConfs {
  private confJsonPath: string;
  private confs: NginxConfJson;

  constructor() {
    this.confJsonPath = `${NGINX_DIR}/confs.json`;
    if (exist(this.confJsonPath)) {
      this.confs = JSON.parse(Deno.readTextFileSync(this.confJsonPath));
    } else {
      this.confs = {};
      this.saveConfsToJson();
    }
  }

  private saveConfsToJson() {
    if (!this.confJsonPath) return;
    Deno.writeTextFileSync(
      this.confJsonPath,
      JSON.stringify(this.confs, undefined, 2),
    );
  }

  public getConfs() {
    return this.confs;
  }

  public getConf(name: string) {
    return this.confs[name];
  }

  public setConf(name: string, conf: NginxConf) {
    this.confs[name] = conf;
    this.saveConfsToJson();
  }

  public deleteConf(name: string) {
    if (!this.confs[name]) return false;
    delete this.confs[name];
    this.saveConfsToJson();
    return true;
  }
}
