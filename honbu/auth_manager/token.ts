import { djwt, oak } from "../deps.ts";
import { createKey } from "../utils/utils.ts";

type Tokens = {
  token: string;
  refreshToken: string;
};

// deno-lint-ignore no-explicit-any
export const isTokens = (obj: any): obj is Tokens =>
  "token" in obj && typeof obj.token === "string" &&
  "refreshToken" in obj && typeof obj.refreshToken === "string";

const tokenKey = await createKey();
const refreshKey = await createKey();
const userTokens: { [id: string]: Tokens | undefined } = {};

export type JwtPayload = {
  id: string;
} & djwt.Payload;

const createToken = (key: CryptoKey, payload: JwtPayload) =>
  djwt.create(
    { alg: "HS512", typ: "JWT" },
    { ...payload, exp: djwt.getNumericDate(60 * 60 * 24 * 2) },
    key,
  );

export const generateTokens = async (id: string) => {
  const payload: JwtPayload = { id: id };
  const token = await createToken(tokenKey, payload);
  const refreshToken = await createToken(refreshKey, payload);
  const tokens = { token, refreshToken };
  userTokens[id] = tokens;
  return tokens;
};

export const removeToken = (id: string) => {
  const isLogedin = userTokens[id] !== undefined;
  if (isLogedin) delete userTokens[id];
  return isLogedin;
};

const verifyToken = (token: string, key: CryptoKey) =>
  djwt.verify(token, key)
    .then((payload) => payload as JwtPayload)
    .catch((err) => {
      console.log(err);
      return undefined;
    });

const verifyAuthToken = (token: string) => verifyToken(token, tokenKey);

export const verifyRefreshToken = (token: string) =>
  verifyToken(token, refreshKey);

const isAvailableRefreshToken = (id: string, refreshToken: string) => {
  const tokens = userTokens[id];
  return tokens && tokens.refreshToken === refreshToken;
};

export const refreshTokens = async (refreshToken: string) => {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) return undefined;

  if (isAvailableRefreshToken(payload.id, refreshToken)) {
    removeToken(payload.id);
    return generateTokens(payload.id);
  } else {
    console.log(`wrong refresh token ${payload} ${refreshToken}`);
    return undefined;
  }
};

type States = {
  token?: string;
  payload?: JwtPayload;
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
    ctx.response.status = 403;
  }
};
