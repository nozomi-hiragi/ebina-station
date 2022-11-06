import { oak } from "../../deps.ts";
import { routingURL } from "../ebina.ts";

const routingRouter = new oak.Router();

// ルート一覧
routingRouter.get("/", async (ctx) => {
  await fetch(`${routingURL}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// ルート詳細
routingRouter.get("/route/:route", async (ctx) => {
  const { route } = ctx.params;
  await fetch(`${routingURL}/route/${route}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.text();
    ctx.response.status = ret.status;
  });
});

// ルート作成
routingRouter.post("/route/:route", async (ctx) => {
  const { route } = ctx.params;
  await fetch(`${routingURL}/route/${route}`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// ルート削除
routingRouter.delete("/route/:route", async (ctx) => {
  const { route } = ctx.params;
  await fetch(`${routingURL}/route/${route}`, {
    method: "DELETE",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// ルート更新
routingRouter.put("/route/:route", async (ctx) => {
  const { route } = ctx.params;
  await fetch(`${routingURL}/route/${route}`, {
    method: "PUT",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// ルート詳細
routingRouter.get("/status", async (ctx) => {
  await fetch(`${routingURL}/status`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.text();
    ctx.response.status = ret.status;
  });
});

// ルート詳細
routingRouter.put("/status", async (ctx) => {
  await fetch(`${routingURL}/status`, {
    method: "PUT",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

export default routingRouter;
