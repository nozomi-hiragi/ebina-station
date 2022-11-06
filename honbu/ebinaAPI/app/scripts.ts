import { oak } from "../../deps.ts";
import { appURL } from "../ebina.ts";

const jsRouter = new oak.Router();

// スクリプトファイル一覧取得
// 200 一覧
// 500 ファイル読めなかった
jsRouter.get("/", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}/script`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// スクリプトファイル作成
// :path
// {}: string?
// 200 OK
// 400 情報おかしい
// 409 もうある
// 500 ファイル関係ミスった
jsRouter.post("/:path", async (ctx) => {
  const { appName, path } = ctx.params;
  await fetch(`${appURL}/${appName}/script/${path}`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// スクリプトファイル取得
// :path
// 200 text
// 400 情報おかしい
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.get("/:path", async (ctx) => {
  const { appName, path } = ctx.params;
  await fetch(`${appURL}/${appName}/script/${path}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

//スクリプトファイル更新
// :path
// 200 OK
// 400 情報おかしい
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.patch("/:path", async (ctx) => {
  const { appName, path } = ctx.params;
  await fetch(`${appURL}/${appName}/script/${path}`, {
    method: "PATCH",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

//スクリプトファイル削除
// :path
// 200 OK
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.delete("/:path", async (ctx) => {
  const { appName, path } = ctx.params;
  await fetch(`${appURL}/${appName}/script/${path}`, {
    method: "DELETE",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

export default jsRouter;
