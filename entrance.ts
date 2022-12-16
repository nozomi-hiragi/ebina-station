import * as oak from "https://deno.land/x/oak@v11.1.0/mod.ts";

Deno.addSignalListener("SIGINT", () => Deno.exit(0));
const FILE_APIS = "apis.json";

interface EntranceArgs {
  appDirPath: string;
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
type RouterFunc = oak.RouterMiddleware<string>;
interface APIItem {
  name: string;
  path: string;
  method: string;
  filename?: string;
  value: string;
}

let appDirPath: string;
// deno-lint-ignore no-explicit-any
const moduleCache: { [filename: string]: any } = {};

const getModule = async (filename: string) => {
  const module = moduleCache[filename];
  if (module) return module;
  const scriptPaht = `./${filename}`;
  return moduleCache[filename] = await import(scriptPaht);
};

const readAPIsJson = (): APIItem[] =>
  JSON.parse(Deno.readTextFileSync(`${appDirPath}/${FILE_APIS}`)).apis;

const apiToFunction = async (api: APIItem): Promise<RouterFunc> => {
  if (api.filename) {
    try {
      const module = await getModule(api.filename);
      return module[api.value];
    } catch (err) {
      return (ctx) => {
        ctx.response.body = err;
        ctx.response.status = 502;
      };
    }
  }
  return (ctx) => ctx.response.body = api.value;
};

const createRouter = async () => {
  const router = new oak.Router();
  const methods: { [m: string]: (p: string, f: RouterFunc) => void } = {
    "get": (p, f) => router.get(p, f),
    "put": (p, f) => router.put(p, f),
    "head": (p, f) => router.head(p, f),
    "post": (p, f) => router.post(p, f),
    "patch": (p, f) => router.patch(p, f),
    "delete": (p, f) => router.delete(p, f),
    "options": (p, f) => router.options(p, f),
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
  const { port, init, final, ...args } = JSON.parse(
    Deno.args[0],
  ) as EntranceArgs;
  appDirPath = args.appDirPath;
  createRouter().then(async (router) => {
    const app = new oak.Application();
    app.use(router.routes(), router.allowedMethods());
    if (init) {
      const module = await getModule(init.filename);
      const func = module[init.function];
      if (func) func(app, router, port);
      else console.log("init finction load failed");
    }
    app.listen({ port });
    if (final) {
      const module = await getModule(final.filename);
      const func = module[final.function];
      if (func) globalThis.addEventListener("unload", () => func(app));
      else console.log("final finction load failed");
    }
  });
};
try {
  main();
} catch (err) {
  console.error(err.toString());
}
