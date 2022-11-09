import { oak } from "../../deps.ts";
import { getApp } from "../../project_data/apps/mod.ts";
import { authToken } from "../../utils/auth.ts";

const jsRouter = new oak.Router();

// スクリプトファイル一覧取得
// 200 一覧
// 500 ファイル読めなかった
jsRouter.get("/", authToken, (ctx) => {
  const { appName } = ctx.params;
  if (!appName) return ctx.response.status = 400;

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return ctx.response.status = 404;

  const fileList = scripts.getFileList();
  if (fileList) {
    ctx.response.status = 200;
    ctx.response.body = fileList;
  } else {
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

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return ctx.response.status = 404;
  if (scripts.exist(path)) return ctx.response.status = 409;

  const body = await ctx.request.body({ type: "text" }).value;
  ctx.response.status = scripts.writeText(path, body) ? 200 : 409;
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

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return ctx.response.status = 404;
  if (!scripts.exist(path)) return ctx.response.status = 404;

  const content = scripts.getText(path);
  if (content) {
    ctx.response.status = 200;
    ctx.response.body = content;
  } else {
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

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return ctx.response.status = 404;
  if (!scripts.exist(path)) return ctx.response.status = 404;

  const body = await ctx.request.body({ type: "text" }).value;
  ctx.response.status = scripts.writeText(path, body) ? 200 : 409;
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

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return ctx.response.status = 404;
  ctx.response.status = scripts.deleteFile(path) ? 200 : 409;
});

export default jsRouter;
