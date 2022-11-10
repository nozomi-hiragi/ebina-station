import { oak } from "../../deps.ts";
import { Settings } from "../../project_data/settings/mod.ts";
import { SettingWebAuthnValues } from "../../project_data/settings/webauthn.ts";
import { authToken } from "../../auth_manager/token.ts";

const projectRouter = new oak.Router();

projectRouter.get("/webauthn", authToken, (ctx) => {
  const settings = Settings.instance();
  const webauthnSettings = settings.WebAuthn;
  if (!webauthnSettings) {
    return ctx.response.status = 503;
  }
  ctx.response.body = webauthnSettings;
});

projectRouter.post("/webauthn", authToken, async (ctx) => {
  const settings = Settings.instance();
  const webauthnSettings: SettingWebAuthnValues = await ctx.request
    .body({ type: "json" }).value;
  if (webauthnSettings.rpName) {
    settings.WebAuthn.setRpName(webauthnSettings.rpName);
  }
  if (webauthnSettings.rpIDType) {
    settings.WebAuthn.setRpIDType(webauthnSettings.rpIDType);
  }
  if (webauthnSettings.rpID) {
    settings.WebAuthn.setRpID(webauthnSettings.rpID);
  }
  if (webauthnSettings.attestationType) {
    settings.WebAuthn.setAttestationType(webauthnSettings.attestationType);
  }
  ctx.response.status = settings.save() ? 200 : 500;
});

projectRouter.get("/mongodb", authToken, (ctx) => {
  const settings = Settings.instance();
  const mongodbSettings = settings.Mongodb;
  if (!mongodbSettings) {
    return ctx.response.status = 503;
  }
  ctx.response.body = {
    port: mongodbSettings.getPortNumber(),
    username: mongodbSettings.getMongodbUsername() === "env" ? "env" : "*****",
    password: mongodbSettings.getMongodbPassword() === "env" ? "env" : "*****",
  };
});

// 不完全 再起動対応とか必要
// projectRouter.post("/mongodb", authToken, async (ctx) => {
//   const settings = Settings.instance();
//   const mongodbSettings: MongoBD = {
//     ...settings.mongodb,
//     ...await ctx.request.body({ type: "json" }).value,
//     databaseFilter: settings.mongodb?.databaseFilter,
//   };
//   settings.mongodb = mongodbSettings;
//   ctx.response.status = setSettings(settings) ? 200 : 500;
// });

export default projectRouter;
