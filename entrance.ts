import { isString } from "https://deno.land/std@0.167.0/encoding/_yaml/utils.ts";
import * as oak from "https://deno.land/x/oak@v11.1.0/mod.ts";

const DIR_SCRIPTS = "scripts";
const FILE_APIS = "apis.json";

async function main(appDirPath: string, port: string) {
  const apiJsonPath = `${appDirPath}/${FILE_APIS}`;
  try {
    Deno.statSync(apiJsonPath);
  } catch (err) {
    console.error("API JSON Error", err);
    return;
  }
  const apisJson = JSON.parse(Deno.readTextFileSync(apiJsonPath));
  const router = new oak.Router();
  const methods: {
    [m: string]: (p: string, f: oak.RouterMiddleware<string>) => void;
  } = {
    "get": (p, f) => router.get(p, f),
    "put": (p, f) => router.put(p, f),
    "head": (p, f) => router.head(p, f),
    "post": (p, f) => router.post(p, f),
    "patch": (p, f) => router.patch(p, f),
    "delete": (p, f) => router.delete(p, f),
    "options": (p, f) => router.options(p, f),
  };
  for (const api of apisJson.apis) {
    if (!api.path || !isString(api.path)) continue;
    if (!api.method || !isString(api.method)) continue;
    if (!api.value || !isString(api.value)) continue;
    let func: oak.RouterMiddleware<string>;
    if (api.filename) {
      try {
        const scriptPaht = `${appDirPath}/${DIR_SCRIPTS}/${api.filename}`;
        const module = await import(scriptPaht);
        func = module[api.value];
      } catch (err) {
        func = (ctx) => {
          ctx.response.body = err;
          ctx.response.status = 502;
        };
      }
    } else func = (ctx) => ctx.response.body = api.value;
    methods[api.method](`/${api.path}`, func);
  }
  new oak.Application().use(router.routes(), router.allowedMethods())
    .listen({ port: Number(port) });
}

if (Deno.args.length >= 2) main(Deno.args[0], Deno.args[1]);
else console.log("no args");
