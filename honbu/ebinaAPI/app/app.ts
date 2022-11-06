import { oak } from "../../deps.ts";
import apiRouter from "./api.ts";
import jsRouter from "./scripts.ts";
import cronRouter from "./cron.ts";
import { appURL } from "../ebina.ts";

const appRouter = new oak.Router();

// アプリ配列取得
// 200 名前ら
appRouter.get("/", async (ctx) => {
  await fetch(`${appURL}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// アプリ作成
// 200 OK
// 400 情報足らない
appRouter.post("/:appName", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// アプリ取得 実質有無確認
// 200 あった
// 400 情報足らない
// 404 なかった
appRouter.get("/:appName", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// アプリ削除 ゴミ箱に移動
// 200 OK
// 404 アプリない
// 500 フォルダ移動ミスった
appRouter.delete("/:appName", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}`, {
    method: "DELETE",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

appRouter.use("/:appName/api", apiRouter.routes());
appRouter.use("/:appName/script", jsRouter.routes());
appRouter.use("/:appName/cron", cronRouter.routes());

export default appRouter;
