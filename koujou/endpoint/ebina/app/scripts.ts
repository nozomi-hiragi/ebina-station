import { oak } from "../../../deps.ts";
import { APPS_DIR } from "../../../settings/settings.ts";
import { authToken } from "../../../utils/auth.ts";
import { logApi } from "../../../utils/log.ts";
import { exist, mkdirIfNotExist } from "../../../utils/utils.ts";

const scriptsDir = "scripts";
const jsRouter = new oak.Router();

const initFolder = (appName: string) =>
  mkdirIfNotExist(`${APPS_DIR}/${appName}/${scriptsDir}`);

// スクリプトファイル一覧取得
// 200 一覧
// 500 ファイル読めなかった
jsRouter.get("/", authToken, (ctx) => {
  const { appName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  try {
    initFolder(appName);
    const baseDir = `${APPS_DIR}/${appName}/${scriptsDir}`;

    const files: string[] = [];
    const exploringDir = (dirPath: string) => {
      for (const name of Deno.readDirSync(`${baseDir}/${dirPath}`)) {
        const relativePath = `${dirPath}/${name.name}`;
        if (Deno.statSync(`${baseDir}/${relativePath}`).isDirectory) {
          exploringDir(`${relativePath}/`);
        } else {
          files.push(relativePath.substring(1));
        }
      }
    };
    exploringDir("");

    ctx.response.body = files;
  } catch (err) {
    logApi.error(["get", "api/scripts", err]);
    console.log(err);
    ctx.response.status = 500;
  }
});

// スクリプトファイル作成
// :path
// {}: string?
// 200 OK
// 400 情報おかしい
// 409 もうある
// 500 ファイル関係ミスった
jsRouter.post("/:path", authToken, async (ctx) => {
  const { appName, path } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  if (path.includes("..")) return ctx.response.status = 400;

  try {
    initFolder(appName);
    const fullPath = `${APPS_DIR}/${appName}/${scriptsDir}/${path}`;
    if (exist(fullPath)) return ctx.response.status = 409;
    const body = await ctx.request.body({ type: "text" }).value;
    Deno.writeTextFileSync(fullPath, body);
    ctx.response.status = 200;
  } catch (err) {
    console.log(err);
    logApi.error(["post", "api/scripts/:paht", err]);
    ctx.response.status = 500;
  }
});

// スクリプトファイル取得
// :path
// 200 text
// 400 情報おかしい
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.get("/:path", authToken, (ctx) => {
  const { appName, path } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  if (path.includes("..")) return ctx.response.status = 400;

  try {
    initFolder(appName);
    const fullPath = `${APPS_DIR}/${appName}/${scriptsDir}/${path}`;
    if (!exist(fullPath)) return ctx.response.status = 404;
    if (Deno.statSync(fullPath).isDirectory) {
      const dir = [];
      for (const item of Deno.readDirSync(fullPath)) {
        dir.push(item.name);
      }
      ctx.response.status = 409;
      ctx.response.body = dir;
    } else {
      const text = Deno.readTextFileSync(fullPath);
      ctx.response.body = text;
    }
  } catch (err) {
    logApi.error(["get", "api/scripts/:path", err]);
    ctx.response.status = 500;
  }
});

//スクリプトファイル更新
// :path
// 200 OK
// 400 情報おかしい
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.patch("/:path", authToken, async (ctx) => {
  const { appName, path } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  if (path.includes("..")) return ctx.response.status = 400;

  try {
    initFolder(appName);
    const fullPath = `${APPS_DIR}/${appName}/${scriptsDir}/${path}`;
    if (!exist(fullPath)) return ctx.response.status = 404;
    if (Deno.statSync(fullPath).isDirectory) return ctx.response.status = 409;

    const body = await ctx.request.body({ type: "text" }).value;
    Deno.writeTextFileSync(fullPath, body);
    ctx.response.status = 200;
  } catch (err) {
    logApi.error(["patch", "api/scripts/:path", err]);
    ctx.response.status = 500;
  }
});

//スクリプトファイル削除
// :path
// 200 OK
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.delete("/:path", authToken, (ctx) => {
  const { appName, path } = ctx.params;
  if (!appName) return ctx.response.status = 400;
  if (path.includes("..")) return ctx.response.status = 400;

  try {
    initFolder(appName);
    const fullPath = `${APPS_DIR}/${appName}/${scriptsDir}/${path}`;
    if (!exist(fullPath)) return ctx.response.status = 404;
    if (Deno.statSync(fullPath).isDirectory) return ctx.response.status = 409;

    Deno.removeSync(fullPath);
    ctx.response.status = 200;
  } catch (err) {
    logApi.error(["delete", "api/scripts/:path", err]);
    ctx.response.status = 500;
  }
});

export default jsRouter;
