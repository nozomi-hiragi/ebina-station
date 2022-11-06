import { oak } from "../../../deps.ts";
import { iWebauthnDeviceURL } from "../../ebina.ts";

const deviceRouter = new oak.Router();

// デバイスら情報取得
// origin:
// ?names
// 200 空でも返す
// 400 情報足りない
// 500 WebAuthnの設定おかしい
deviceRouter.get("/", async (ctx) => {
  await fetch(`${iWebauthnDeviceURL}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// デバイスら削除
// origin:
// :deviceName
// ?names
// 200 OK
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.delete("/", async (ctx) => {
  await fetch(`${iWebauthnDeviceURL}`, {
    method: "DELETE",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// デバイス情報取得
// origin:
// :deviceName
// 200 空でも返す
// 400 情報足りない
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.get("/:deviceName", async (ctx) => {
  const { deviceName } = ctx.params;
  await fetch(`${iWebauthnDeviceURL}/${deviceName}`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// デバイス削除
// origin:
// :deviceName
// 200 OK
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.delete("/:deviceName", async (ctx) => {
  const { deviceName } = ctx.params;
  await fetch(`${iWebauthnDeviceURL}/${deviceName}`, {
    method: "DELETE",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// デバイス有効確認
// origin:
// :deviceName
// 200 こたえ
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.get("/:deviceName/enable", async (ctx) => {
  const { deviceName } = ctx.params;
  await fetch(`${iWebauthnDeviceURL}/${deviceName}/enable`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// デバイス有効
// origin:
// :deviceName
// 200 OK
// 208 もうある
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.post("/:deviceName/enable", async (ctx) => {
  const { deviceName } = ctx.params;
  await fetch(`${iWebauthnDeviceURL}/${deviceName}/enable`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// デバイス無効
// origin:
// :deviceName
// 200 OK
// 208 もうない
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.post("/:deviceName/disable", async (ctx) => {
  const { deviceName } = ctx.params;
  await fetch(`${iWebauthnDeviceURL}/${deviceName}/disable`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

export default deviceRouter;
