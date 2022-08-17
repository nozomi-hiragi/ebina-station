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
    body: JSON.stringify({ key: honbuKey }),
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

export const isEnableHonbu = () => honbuParams !== undefined;
