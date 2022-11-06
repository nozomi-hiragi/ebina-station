import { oak } from "../../deps.ts";
import { appURL } from "../ebina.ts";

const cronRouter = new oak.Router();

cronRouter.get("/", async (ctx) => {
  const { appName } = ctx.params;
  await fetch(`${appURL}/${appName}/cron`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

cronRouter.post("/:cronName", async (ctx) => {
  const { appName, cronName } = ctx.params;
  await fetch(`${appURL}/${appName}/cron/${cronName}`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

cronRouter.get("/:cronName", async (ctx) => {
  const { appName, cronName } = ctx.params;
  await fetch(`${appURL}/${appName}/cron/${cronName}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

cronRouter.patch("/:cronName", async (ctx) => {
  const { appName, cronName } = ctx.params;
  await fetch(`${appURL}/${appName}/cron/${cronName}`, {
    method: "PATCH",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

cronRouter.delete("/:cronName", async (ctx) => {
  const { appName, cronName } = ctx.params;
  await fetch(`${appURL}/${appName}/cron/${cronName}`, {
    method: "DELETE",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

export default cronRouter;
