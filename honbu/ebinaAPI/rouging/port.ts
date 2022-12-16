import { oak, TypeUtils } from "../../deps.ts";
import { authToken } from "../../auth_manager/token.ts";
import {
  getPort,
  getPorts,
  PORT_START,
  setPort,
} from "../../project_data/apps/ports.ts";

const portRouter = new oak.Router();

portRouter.get("/numbers", authToken, (ctx) => {
  ctx.response.status = 200;
  ctx.response.body = { start: PORT_START, ports: getPorts() };
});

portRouter.get("/number/:name", authToken, (ctx) => {
  const { name } = ctx.params;
  const port = getPort(name);
  ctx.response.status = port === undefined ? 404 : 200;
  ctx.response.body = { port };
});

portRouter.put("/number/:name", authToken, async (ctx) => {
  const { name } = ctx.params;
  const { port } = await ctx.request.body({ type: "json" }).value;
  if (!port || !TypeUtils.isNumber(port)) return ctx.response.status = 400;
  ctx.response.status = setPort(name, port) ? 200 : 409;
});

export default portRouter;
