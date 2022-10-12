import { oak } from "../../deps.ts";
import iRouter from "./i/i.ts";
import memberRouter from "./member/member.ts";
import appRouter from "./app/app.ts";
import projectRouter from "./settings/settings.ts";
import databaseRouter from "./database/database.ts";
import routingRouter from "./rouging/routing.ts";

const ebinaRouter = new oak.Router();

ebinaRouter.use("/i", iRouter.routes());
ebinaRouter.use("/member", memberRouter.routes());
ebinaRouter.use("/app", appRouter.routes());
ebinaRouter.use("/settings", projectRouter.routes());
ebinaRouter.use("/database", databaseRouter.routes());
ebinaRouter.use("/routing", routingRouter.routes());

export default ebinaRouter;
