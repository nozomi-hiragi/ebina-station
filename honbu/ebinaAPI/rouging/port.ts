import { isNumber } from "std/encoding/_yaml/utils.ts";
import { Hono } from "hono/mod.ts";
import { authToken, AuthTokenVariables } from "../../auth_manager/token.ts";
import {
  getPort,
  getPorts,
  PORT_START,
  setPort,
} from "../../project_data/apps/ports.ts";

const portRouter = new Hono<{ Variables: AuthTokenVariables }>();

portRouter.get("/numbers", authToken, (c) => {
  return c.json({ start: PORT_START, ports: getPorts() }, 200);
});

portRouter.get("/number/:name", authToken, (c) => {
  const { name } = c.req.param();
  const port = getPort(name);
  return c.json({ port }, port === undefined ? 404 : 200);
});

portRouter.put("/number/:name", authToken, async (c) => {
  const { name } = c.req.param();
  const { port } = await c.req.json<{ port: number }>();
  if (!port || !isNumber(port)) return c.json({}, 400);
  return c.json({}, setPort(name, port) ? 200 : 409);
});

export default portRouter;
