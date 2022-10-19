import { djwt, oak } from "../deps.ts";
import { logKoujou } from "./log.ts";
import { States } from "../index.ts";

type JwtToken = {
  token: string;
  refreshToken: string;
};

// deno-lint-ignore no-explicit-any
export const isJwtToken = (obj: any): obj is JwtToken =>
  "token" in obj && typeof obj.token === "string" &&
  "refreshToken" in obj && typeof obj.refreshToken === "string";

const userTokens: { [key: string]: JwtToken } = {};

export type JwtPayload = {
  id: string;
} & djwt.Payload;

const getKey = async (filename: string) => {
  return await Deno.readTextFile(`./${filename}`)
    .then(async (keyString) => {
      const key = await crypto.subtle.importKey(
        "jwk",
        JSON.parse(keyString),
        { name: "HMAC", hash: "SHA-512" },
        true,
        ["verify", "sign"],
      );
      return key;
    })
    .catch(async () => {
      const key = await window.crypto.subtle.generateKey(
        { name: "HMAC", hash: "SHA-512" },
        true,
        ["verify", "sign"],
      );
      const exportedKey = await crypto.subtle.exportKey(
        "jwk",
        key,
      ).then((key) => key);
      Deno.writeTextFileSync(`./${filename}`, `${JSON.stringify(exportedKey)}`);
      return key;
    });
};

export const generateJwtToken = async (payload: JwtPayload) => {
  const tokenKey = await getKey("token.key");
  const token = await djwt.create(
    { alg: "HS512", typ: "JWT" },
    { ...payload, exp: djwt.getNumericDate(60 * 60 * 24 * 2) },
    tokenKey,
  );

  const refreshKey = await getKey("refreshtoken.key");
  const refreshToken = await djwt.create(
    { alg: "HS512", typ: "JWT" },
    { ...payload, exp: djwt.getNumericDate(60 * 60 * 24 * 30) },
    refreshKey,
  );
  return { token, refreshToken };
};

const verifyAuthToken = async (token: string) => {
  try {
    const key = await getKey("token.key");
    return await djwt.verify(token, key) as JwtPayload;
  } catch (err) {
    logKoujou.info([`verifyAuthToken ${token} ${err}`, token, err]);
  }
};

const verifyRefreshToken = async (token: string) => {
  try {
    const key = await getKey("refreshtoken.key");
    return await djwt.verify(token, key) as JwtPayload;
  } catch (err) {
    logKoujou.info(["verifyRefreshToken", token, err]);
  }
};

export const generateTokens = async (id: string) => {
  const tokens = await generateJwtToken({ id: id });
  userTokens[id] = tokens;
  return tokens;
};

export const isAvailableToken = (id: string, token: string) => {
  const tokens = userTokens[id];
  return tokens && tokens.token === token;
};

export const removeToken = (id: string) => {
  const isLogedin = userTokens[id] !== undefined;
  if (isLogedin) {
    delete userTokens[id];
  }
  return isLogedin;
};

export const authToken = async (
  ctx: oak.Context<States>,
  next: () => Promise<unknown>,
) => {
  const authHeader = ctx.request.headers.get("authorization");
  if (!authHeader) return ctx.response.status = 401;
  const tokenArray = authHeader.split(" ");
  if (tokenArray[0] !== "Bearer") return ctx.response.status = 400;
  const token = tokenArray[1];
  const payload = await verifyAuthToken(token);
  if (payload) {
    ctx.state.token = token;
    ctx.state.payload = payload;
    await next();
  } else {
    ctx.response.status = 401;
  }
};

export const refreshTokens = async (refreshToken: string, id?: string) => {
  const payload = await verifyRefreshToken(refreshToken) as JwtPayload;
  if (!payload) return undefined;

  if (id && payload.id !== id) {
    removeToken(payload.id);
    logKoujou.info(["refreshTokens", "wrong user", id, payload]);
    return undefined;
  }

  if (userTokens[payload.id]?.refreshToken === refreshToken) {
    removeToken(payload.id);
    return generateTokens(payload.id);
  } else {
    logKoujou.info(["refreshTokens", "not logedin this user", payload]);
    return undefined;
  }
};
