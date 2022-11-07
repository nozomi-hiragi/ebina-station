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

export default ebinaRouter;
