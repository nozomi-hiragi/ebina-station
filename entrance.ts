import { serve } from "https://deno.land/std@0.177.0/http/mod.ts";
import { Hono } from "https://deno.land/x/hono@v3.0.1/mod.ts";
import { Handler } from "https://deno.land/x/hono@v3.0.1/types.ts";

Deno.addSignalListener("SIGINT", () => Deno.exit(0));
const FILE_APIS = "apis.json";

interface EntranceArgs {
  port: number;
  init?: {
    filename: string;
    function: string;
  };
  final?: {
    filename: string;
    function: string;
  };
}

interface APIItem {
  name: string;
  path: string;
  method: string;
  filename?: string;
  value: string;
}

export const appDir = new URL("../", import.meta.url).pathname;
// deno-lint-ignore no-explicit-any
const moduleCache: { [filename: string]: any } = {};

const getModule = async (filename: string) => {
  const module = moduleCache[filename];
  if (module) return module;
  const scriptPath = `./${filename}`;
  return moduleCache[filename] = await import(scriptPath);
};

const readAPIsJson = (): APIItem[] =>
  JSON.parse(Deno.readTextFileSync(`${appDir}/${FILE_APIS}`)).apis;

const apiToFunction = async (api: APIItem): Promise<Handler> => {
  if (api.filename) {
    try {
      const module = await getModule(api.filename);
      return module[api.value];
    } catch (err) {
      return (c) => c.text(err.toString(), 502);
    }
  }
  return (c) => c.text(api.value);
};

const createRouter = async () => {
  const router = new Hono();
  const methods: { [m: string]: (p: string, h: Handler) => void } = {
    "get": (p, h) => router.get(p, h),
    "put": (p, h) => router.put(p, h),
    "head": (p, h) => router.head(p, h),
    "post": (p, h) => router.post(p, h),
    "patch": (p, h) => router.patch(p, h),
    "delete": (p, h) => router.delete(p, h),
    "options": (p, h) => router.options(p, h),
  };
  await Promise.all(
    readAPIsJson().map(async (api) =>
      methods[api.method](`/${api.path}`, await apiToFunction(api))
    ),
  );
  return router;
};

const main = () => {
  if (!Deno.args.length) throw new Error("no args");
  const { port, init, final } = JSON.parse(
    Deno.args[0],
  ) as EntranceArgs;
  createRouter().then(async (router) => {
    const app = new Hono();
    if (init) {
      const module = await getModule(init.filename);
      const func = module[init.function];
      if (func) func(app, router, port);
      else console.log("init function load failed");
    }
    app.route("/", router);
    serve(app.fetch, { port });
    if (final) {
      const module = await getModule(final.filename);
      const func = module[final.function];
      if (func) globalThis.addEventListener("unload", () => func(app));
      else console.log("final function load failed");
    }
  });
};
try {
  main();
} catch (err) {
  console.error(err.toString());
}
