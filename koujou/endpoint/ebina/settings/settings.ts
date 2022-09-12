import { oak } from "../../../deps.ts";
import {
  getSettings,
  MongoBD,
  setSettings,
} from "../../../settings/settings.ts";
import { authToken } from "../../../utils/auth.ts";

const projectRouter = new oak.Router();

projectRouter.get("/mongodb", authToken, (ctx) => {
  const settings = getSettings();
  const mongodbSettings = settings.mongodb;
  if (!mongodbSettings) {
    return ctx.response.status = 503;
  }
  ctx.response.body = mongodbSettings;
});

projectRouter.post("/mongodb", authToken, async (ctx) => {
  const settings = getSettings();
  const mongodbSettings: MongoBD = await ctx.request
    .body({ type: "json" }).value;
  settings.mongodb = mongodbSettings;
  ctx.response.status = setSettings(settings) ? 200 : 500;
});

export default projectRouter;
