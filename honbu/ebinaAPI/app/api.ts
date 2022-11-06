import { oak } from "../../deps.ts";
import { appURL } from "../ebina.ts";

const apiRouter = new oak.Router();

// API起動状態取得
// 200 { status: 'started' | 'stop', started_at: number }
apiRouter.get("/status", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}/api/status`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// API起動状態更新
// { status: 'start' | 'stop' }
// 200 できた
// 400 情報おかしい
// 500 起動できなかった
apiRouter.put("/status", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}/api/status`, {
    method: "PUT",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// ポート取得
// 200 { port: number }
apiRouter.get("/port", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}/api/port`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// ポート設定
// { port: number }
// 200 OK
// 400 情報おかしい
apiRouter.put("/port", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}/api/port`, {
    method: "PUT",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// API一覧取得
// 200 { path, api }
apiRouter.get("/endpoint", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}/api/endpoint`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// API作成
// :path
// { name, method, type, value }
// 200 OK
// 400 情報おかしい
apiRouter.post("/endpoint/:path", async (ctx) => {
  const { appName, path } = ctx.params;
  await fetch(`${appURL}/${appName}/api/endpoint/${path}`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// API取得
// :path
// 200 API
// 400 情報おかしい
// 404 ない
apiRouter.get("/endpoint/:path", async (ctx) => {
  const { appName, path } = ctx.params;
  await fetch(`${appURL}/${appName}/api/endpoint/${path}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// API更新
// :path
// 200 OK
// 400 情報おかしい
apiRouter.put("/endpoint/:path", async (ctx) => {
  const { appName, path } = ctx.params;
  await fetch(`${appURL}/${appName}/api/endpoint/${path}`, {
    method: "PUT",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// API削除
// 200 OK
// 400 情報おかしい
// 404 パスない
apiRouter.delete("/endpoint/:path", async (ctx) => {
  const { appName, path } = ctx.params;
  await fetch(`${appURL}/${appName}/api/endpoint/${path}`, {
    method: "DELETE",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

export default apiRouter;
