import { isExist, mkdirIfNotExist } from "../../utils/utils.ts";
import { APPS_DIR } from "../mod.ts";

const SCRIPTS_DIR = "scripts";

export class Scripts {
  private scriptDir: string;

  constructor(appName: string) {
    this.scriptDir = `${APPS_DIR}/${appName}/${SCRIPTS_DIR}`;
    mkdirIfNotExist(this.scriptDir);
  }

  exist(path: string) {
    const fullPath = `${this.scriptDir}/${path}`;
    return isExist(fullPath);
  }

  getFileList() {
    const files: string[] = [];
    try {
      for (const info of Deno.readDirSync(`${this.scriptDir}`)) {
        if (info.isFile) {
          files.push(info.name);
        }
      }
      return files;
    } catch (err) {
      console.log(err);
      return undefined;
    }
  }

  writeText(path: string, content: string) {
    const fullPath = `${this.scriptDir}/${path}`;
    const info = isExist(fullPath);
    if (!info || info.isDirectory) return false;
    try {
      Deno.writeTextFileSync(fullPath, content);
      return true;
    } catch (err) {
      console.log(err);
      return false;
    }
  }

  getText(path: string) {
    const fullPath = `${this.scriptDir}/${path}`;
    const info = isExist(fullPath);
    if (!info || info.isDirectory) return undefined;
    try {
      const content = Deno.readTextFileSync(fullPath);
      return content;
    } catch (err) {
      console.log(err);
      return undefined;
    }
  }

  deleteFile(path: string) {
    const fullPath = `${this.scriptDir}/${path}`;
    const info = isExist(fullPath);
    if (!info) return false;
    if (info.isDirectory) return false;
    try {
      Deno.removeSync(fullPath);
      return true;
    } catch (err) {
      console.log(err);
      return false;
    }
  }
}
