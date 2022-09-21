import { oak } from "../deps.ts";

type HonbuParams = {
  honbuAddress: string;
  honbuKey: string;
};

let honbuParams: HonbuParams | undefined;

export const initHonbuDelegate = async () => {
  if (Deno.env.get("HONBU") !== "true") return false;

  const host = Deno.env.get("HONBU_ADDRESS");
  const port = Deno.env.get("HONBU_PORT");
  if (host === undefined || port === undefined) {
    throw new Error("host or port are undefined");
  }
  const honbuAddress = `http://${host}:${port}`;

  const honbuKey = Deno.env.get("HONBU_KEY");
  if (honbuKey === undefined) throw new Error("key is undefined");

  const ret = await fetch(`${honbuAddress}/ping`, {
    method: "POST",
    headers: { key: honbuKey },
  });
  if (ret.status !== 200) {
    throw new Error(`Honbu connection error: ${ret.status}`);
  }

  honbuParams = {
    honbuAddress,
    honbuKey,
  };
  return true;
};

export const checkHonbuKey = async (
  ctx: oak.Context,
  next: () => Promise<unknown>,
) => {
  if (!honbuParams) return ctx.response.status = 503;
  const key = ctx.request.headers.get("key");

  if (key !== "" && (honbuParams?.honbuKey ?? "") === key) {
    await next();
  } else {
    ctx.response.status = 401;
  }
};

export const isEnableHonbu = () => honbuParams !== undefined;
