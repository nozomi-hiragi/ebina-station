import { oak } from "../../deps.ts";
import { memberURL } from "../ebina.ts";

const memberRouter = new oak.Router();

// 仮登録
// { id, name, pass }
// 201 オプションあげる
// 400 パラメ足らん
// 409 メンバ競合
memberRouter.post("/regist/option", async (ctx) => {
  await fetch(`${memberURL}/regist/option`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// 仮登録認証
// { id, name, pass }
// 200 できた
// 400 パラメ足らん
// 401 トークン違う
// 404 いない
memberRouter.post("/regist/verify", async (ctx) => {
  await fetch(`${memberURL}/regist/verify`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// メンバー配列取得 ID無いなら全部
// ?ids
// 200 空でも返す
memberRouter.get("/", async (ctx) => {
  await fetch(`${memberURL}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// メンバー配列削除
// ?ids
// 200 全部できた
// 206 一部できた
// 404 全部できない
memberRouter.delete("/", async (ctx) => {
  await fetch(`${memberURL}`, {
    method: "DELETE",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// メンバー取得
// :id
// 200 メンバー
// 400 IDない
// 404 みつからない
memberRouter.get("/:id", async (ctx) => {
  const { id } = ctx.params;
  await fetch(`${memberURL}/${id}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

export default memberRouter;
