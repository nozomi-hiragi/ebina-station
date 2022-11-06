import { oak } from "../deps.ts";
import appRouter from "./app/app.ts";
import databaseRouter from "./database/database.ts";
import iRouter from "./i/i.ts";
import memberRouter from "./member/member.ts";
import routingRouter from "./rouging/routing.ts";
import settingsRouter from "./settings/settings.ts";

const ebinaRouter = new oak.Router();

ebinaRouter.use("/i", iRouter.routes());
ebinaRouter.use("/member", memberRouter.routes());
ebinaRouter.use("/app", appRouter.routes());
ebinaRouter.use("/settings", settingsRouter.routes());
ebinaRouter.use("/database", databaseRouter.routes());
ebinaRouter.use("/routing", routingRouter.routes());

// @TODO 現状ポート固定
export const baseURL = "http://localhost:3456/ebina";

export const iURL = baseURL + "/i";
export const iWebauthnURL = iURL + "/webauthn";
export const iWebauthnDeviceURL = iWebauthnURL + "/device";

export const memberURL = baseURL + "/member";

export const appURL = baseURL + "/app";

export const settingsURL = baseURL + "/settings";

export const databaseURL = baseURL + "/database";

export const routingURL = baseURL + "/routing";

export default ebinaRouter;
