import { Hono } from "hono/mod.ts";
import { Settings } from "../../project_data/settings/mod.ts";
import { SettingWebAuthnValues } from "../../project_data/settings/webauthn.ts";
import { authToken } from "../../auth_manager/token.ts";

const projectRouter = new Hono();

projectRouter.get("/webauthn", authToken, (c) => {
  const settings = Settings.instance();
  const webauthnSettings = settings.WebAuthn;
  if (!webauthnSettings) {
    return c.json({}, 503);
  }
  return c.json(webauthnSettings.getRawValue());
});

projectRouter.post("/webauthn", authToken, async (c) => {
  const settings = Settings.instance();
  const webauthnSettings: SettingWebAuthnValues = await c.req.json();
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
  return c.json({}, settings.save() ? 200 : 500);
});

projectRouter.get("/mongodb", authToken, (c) => {
  const settings = Settings.instance();
  const mongodbSettings = settings.Mongodb;
  if (!mongodbSettings) {
    return c.json({}, 503);
  }
  return c.json({
    port: mongodbSettings.getPortNumber(),
    username: mongodbSettings.getMongodbUsername() === "env" ? "env" : "*****",
    password: mongodbSettings.getMongodbPassword() === "env" ? "env" : "*****",
  });
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
