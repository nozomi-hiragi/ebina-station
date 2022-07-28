import * as oak from "https://deno.land/x/oak@v10.6.0/mod.ts";

type Method = "get" | "head" | "post" | "put" | "delete" | "options" | "patch";
type Type = "static" | "JavaScript";
type OakAPIFunc = <
  R extends string,
  P extends oak.RouteParams<R> = oak.RouteParams<R>,
  // deno-lint-ignore no-explicit-any
  S extends oak.State = Record<string, any>,
>(
  context: oak.RouterContext<R, P, S>,
  next: () => Promise<unknown>,
) => Promise<unknown> | unknown;

const scriptsDir = "scripts";

async function main(appDirPath: string) {
  const apiJsonPath = `${appDirPath}/apis.json`;
  try {
    Deno.statSync(apiJsonPath);
  } catch (err) {
    console.error("API JSON Error", err);
    return;
  }
  const apisJson = JSON.parse(Deno.readTextFileSync(apiJsonPath));

  const router = new oak.Router();
  for (const apiKey of Object.keys(apisJson.apis)) {
    const api = apisJson.apis[apiKey];
    const apiPath = `/${apiKey}`;

    let func: OakAPIFunc;
    switch (api.type as Type) {
      case "static":
        func = (ctx) => {
          ctx.response.body = api.value;
        };
        break;
      case "JavaScript": {
        const args = api.value.split(">");
        const jspaht = `${appDirPath}/${scriptsDir}/${args[0]}`;
        const module = await import(jspaht);
        func = module[args[1]];
        break;
      }
      default:
        func = (ctx) => ctx.response.status = 501;
    }

    switch (api.method as Method) {
      case "get":
        router.get(apiPath, func);
        break;
      case "head":
        router.head(apiPath, func);
        break;
      case "post":
        router.post(apiPath, func);
        break;
      case "put":
        router.put(apiPath, func);
        break;
      case "delete":
        router.delete(apiPath, func);
        break;
      case "options":
        router.options(apiPath, func);
        break;
      case "patch":
        router.patch(apiPath, func);
        break;
    }
  }
  const port = apisJson.port || 1234;

  const app = new oak.Application();
  app.use(router.routes(), router.allowedMethods());
  app.listen({ port });
}

if (Deno.args.length) {
  main(Deno.args[0]);
} else {
  console.log("no args");
}
