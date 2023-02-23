import { Context, Hono } from "hono/mod.ts";
import { getApp } from "../../project_data/apps/mod.ts";
import { authToken, AuthTokenVariables } from "../../auth_manager/token.ts";

const jsRouter = new Hono<{ Variables: AuthTokenVariables }>();

// スクリプトファイル一覧取得
// 200 一覧
// 500 ファイル読めなかった
jsRouter.get("/", authToken, (c: Context) => {
  const { appName } = c.req.param();
  if (!appName) return c.json({}, 400);

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return c.json({}, 404);

  const fileList = scripts.getFileList();
  if (fileList) {
    return c.json(fileList.sort(), 200);
  } else {
    return c.json({}, 500);
  }
});

// スクリプトファイル作成
// :path
// {}: string?
// 200 OK
// 400 情報おかしい
// 409 もうある
// 500 ファイル関係ミスった
jsRouter.post("/:path", authToken, async (c: Context) => {
  const { appName, path } = c.req.param();
  if (!appName) return c.json({}, 400);
  if (path.includes("..")) return c.json({}, 400);

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return c.json({}, 404);
  if (scripts.exist(path)) return c.json({}, 409);

  const body = await c.req.text();
  return c.json({}, scripts.writeText(path, body) ? 200 : 409);
});

// スクリプトファイル取得
// :path
// 200 text
// 400 情報おかしい
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.get("/:path", authToken, (c: Context) => {
  const { appName, path } = c.req.param();
  if (!appName) return c.json({}, 400);
  if (path.includes("..")) return c.json({}, 400);

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return c.json({}, 404);
  if (!scripts.exist(path)) return c.json({}, 404);

  const content = scripts.getText(path);
  if (content) {
    return c.text(content, 200);
  } else {
    return c.json({}, 500);
  }
});

//スクリプトファイル更新
// :path
// 200 OK
// 400 情報おかしい
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.patch("/:path", authToken, async (c: Context) => {
  const { appName, path } = c.req.param();
  if (!appName) return c.json({}, 400);
  if (path.includes("..")) return c.json({}, 400);

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return c.json({}, 404);
  if (!scripts.exist(path)) return c.json({}, 404);

  const body = await c.req.text();
  return c.json({}, scripts.writeText(path, body) ? 200 : 409);
});

//スクリプトファイル削除
// :path
// 200 OK
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.delete("/:path", authToken, (c: Context) => {
  const { appName, path } = c.req.param();
  if (!appName) return c.json({}, 400);
  if (path.includes("..")) return c.json({}, 400);

  const scripts = getApp(appName)?.scripts;
  if (!scripts) return c.json({}, 404);
  return c.json({}, scripts.deleteFile(path) ? 200 : 409);
});

export default jsRouter;
