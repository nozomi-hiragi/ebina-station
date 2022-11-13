import { isString } from "https://deno.land/std@0.158.0/encoding/_yaml/utils.ts";
import * as oak from "https://deno.land/x/oak@v11.1.0/mod.ts";

type Method = "get" | "head" | "post" | "put" | "delete" | "options" | "patch";
type Type = "static" | "JavaScript";

const DEFAULT_PORT = 1234;
const DIR_SCRIPTS = "scripts";
const FILE_APIS = "apis.json";

async function main(appDirPath: string) {
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
  for (const apiKey of Object.keys(apisJson.apis)) {
    const api: { type: Type; method: Method; value: string } =
      apisJson.apis[apiKey];
    if (
      !api.type || !isString(api.type) ||
      !api.method || !isString(api.method) ||
      !api.value || !isString(api.value)
    ) continue;

    let func: oak.RouterMiddleware<string>;
    switch (api.type) {
      case "static":
        func = (ctx) => ctx.response.body = api.value;
        break;
      case "JavaScript":
        try {
          const args = api.value.split(">");
          const scriptPaht = `${appDirPath}/${DIR_SCRIPTS}/${args[0]}`;
          const module = await import(scriptPaht);
          func = module[args[1]];
        } catch (err) {
          func = (ctx) => {
            ctx.response.body = err;
            ctx.response.status = 502;
          };
        }
        break;
      default:
        func = (ctx) => ctx.response.status = 501;
    }
    const apiPath = `/${apiKey}`;
    methods[api.method](apiPath, func);
  }
  new oak.Application()
    .use(router.routes(), router.allowedMethods())
    .listen({ port: apisJson.port || DEFAULT_PORT });
}

if (Deno.args.length) main(Deno.args[0]);
else console.log("no args");
