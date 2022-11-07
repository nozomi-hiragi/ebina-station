import { oak } from "../../deps.ts";
import {
  getSettings,
  setSettings,
  WebAuthnSetting,
} from "../../project_data/settings.ts";
import { authToken } from "../../utils/auth.ts";

const projectRouter = new oak.Router();

projectRouter.get("/webauthn", authToken, (ctx) => {
  const settings = getSettings();
  const webauthnSettings = settings.WebAuthn;
  if (!webauthnSettings) {
    return ctx.response.status = 503;
  }
  ctx.response.body = webauthnSettings;
});

projectRouter.post("/webauthn", authToken, async (ctx) => {
  const settings = getSettings();
  const webauthnSettings: WebAuthnSetting = await ctx.request
    .body({ type: "json" }).value;
  settings.WebAuthn = { ...settings.WebAuthn, ...webauthnSettings };
  ctx.response.status = setSettings(settings) ? 200 : 500;
});

projectRouter.get("/mongodb", authToken, (ctx) => {
  const settings = getSettings();
  const mongodbSettings = settings.MongoDB;
  if (!mongodbSettings) {
    return ctx.response.status = 503;
  }
  ctx.response.body = {
    port: mongodbSettings.port,
    username: mongodbSettings.username === "env"
      ? mongodbSettings.username
      : "*****",
    password: mongodbSettings.password === "env"
      ? mongodbSettings.password
      : "*****",
  };
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
