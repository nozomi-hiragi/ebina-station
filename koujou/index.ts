import { oak, oakCors } from "./deps.ts";
import ebinaRouter from "./ebinaAPI/index.ts";
import { getSettings } from "./project_data/settings.ts";
import { logKoujou } from "./utils/log.ts";
import { JwtPayload } from "./utils/auth.ts";

export type States = {
  token?: string;
  payload?: JwtPayload;
};

const settings = getSettings();

const port = settings.getPort();
const app = new oak.Application<States>();
if (settings.origins) {
  app.use(oakCors({ origin: settings.origins, credentials: true }));
}

const router = new oak.Router();
router.use("/ebina", ebinaRouter.routes());
app.use(router.routes(), router.allowedMethods());

app.listen({ port });
logKoujou.info(`EbinaStation Start lestening on ${port}`);
