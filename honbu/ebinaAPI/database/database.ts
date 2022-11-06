import { oak } from "../../deps.ts";
import { databaseURL } from "../ebina.ts";

const databaseRouter = new oak.Router();

databaseRouter.get("/", async (ctx) => {
  await fetch(`${databaseURL}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

databaseRouter.get("/:db", async (ctx) => {
  const { db } = ctx.params;
  await fetch(`${databaseURL}/${db}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

databaseRouter.get("/:db/:collection/find", async (ctx) => {
  const { db, collection } = ctx.params;
  await fetch(`${databaseURL}/${db}/${collection}/find`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

databaseRouter.get("/user", async (ctx) => {
  await fetch(`${databaseURL}/user`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

databaseRouter.post("/user", async (ctx) => {
  await fetch(`${databaseURL}/user`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

databaseRouter.delete("/user/:username", async (ctx) => {
  const { username } = ctx.params;
  await fetch(`${databaseURL}/user/${username}`, {
    method: "DELETE",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

export default databaseRouter;
