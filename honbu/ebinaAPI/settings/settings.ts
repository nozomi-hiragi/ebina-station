import { oak } from "../../deps.ts";
import { settingsURL } from "../ebina.ts";
// import {
//   getSettings,
//   setSettings,
//   WebAuthnSetting,
// } from "../../../settings/settings.ts";
// import { authToken } from "../../../utils/auth.ts";

const projectRouter = new oak.Router();

projectRouter.get("/webauthn", async (ctx) => {
  await fetch(`${settingsURL}/webauthn`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

projectRouter.post("/webauthn", async (ctx) => {
  await fetch(`${settingsURL}/webauthn`, {
    method: "POST",
    headers: ctx.request.headers,
    body: await ctx.request.body({ type: "text" }).value,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

projectRouter.get("/mongodb", async (ctx) => {
  await fetch(`${settingsURL}/mongodb`, {
    method: "GET",
    headers: ctx.request.headers,
  }).then(async (ret) => {
    ctx.response.body = await ret.json();
    ctx.response.status = ret.status;
  });
});

// 不完全 再起動対応とか必要
// projectRouter.post("/mongodb", authToken, async (ctx) => {
//   const settings = getSettings();
//   const mongodbSettings: MongoBD = {
//     ...settings.mongodb,
//     ...await ctx.request.body({ type: "json" }).value,
//     databaseFilter: settings.mongodb?.databaseFilter,
//   };
//   settings.mongodb = mongodbSettings;
//   ctx.response.status = setSettings(settings) ? 200 : 500;
// });

export default projectRouter;
