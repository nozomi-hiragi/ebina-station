import * as oak from "https://deno.land/x/oak@v10.6.0/mod.ts";

type Method = "get" | "head" | "post" | "put" | "delete" | "options" | "patch";
type Type = "static" | "JavaScript";

if (Deno.args.length) {
  const apiDirPath = Deno.args[0];
  const apiJsonPath = `${apiDirPath}/apis.json`;
  console.log(apiJsonPath);
  const apisJson = JSON.parse(Deno.readTextFileSync(apiJsonPath));

  const port = apisJson.port || 1234;

  const app = new oak.Application();
  const router = new oak.Router();

  for (const apiKey of Object.keys(apisJson.apis)) {
    const api = apisJson.apis[apiKey];
    const apiPath = `/${apiKey}`;

    let func: <
      R extends string,
      P extends oak.RouteParams<R> = oak.RouteParams<R>,
      // deno-lint-ignore no-explicit-any
      S extends oak.State = Record<string, any>,
    >(
      context: oak.RouterContext<R, P, S>,
      next: () => Promise<unknown>,
    ) => Promise<unknown> | unknown;

    switch (api.type as Type) {
      case "static":
        func = (ctx) => {
          ctx.response.body = api.value;
        };
        break;
      case "JavaScript": {
        const args = api.value.split(">");
        const jspaht = `${apiDirPath}/js/${args[0]}`;
        const module = await import(jspaht);
        func = module[args[1]];
        break;
      }
      default:
        func = (ctx) => {
          ctx.response.body = "ha";
        };
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

  app.use(router.routes());
  app.listen({ port });
}
