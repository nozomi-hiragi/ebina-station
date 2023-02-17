import * as djwt from "djwt";
import { oak } from "../deps.ts";
import { logEbina } from "../utils/log.ts";
import { createKey } from "../utils/utils.ts";

const tokenKey = await createKey();

export type JwtPayload = {
  id: string;
} & djwt.Payload;

const createToken = (key: CryptoKey, payload: JwtPayload, expMs: number) =>
  djwt.create(
    { alg: "HS512", typ: "JWT" },
    { ...payload, exp: djwt.getNumericDate(expMs) },
    key,
  );

export const generateTokens = async (id: string) => {
  const payload: JwtPayload = { id: id };
  const token = await createToken(tokenKey, payload, 60 * 60 * 12);
  return token;
};

const verifyToken = (token: string, key: CryptoKey) =>
  djwt.verify(token, key)
    .then((payload) =>
      djwt.validate([{ alg: "" }, payload, new Uint8Array()]).payload
    )
    .then((payload) => payload as JwtPayload)
    .catch((_: RangeError) => undefined)
    .catch((err) => {
      logEbina.error("Verify token error:", err);
      return undefined;
    });

const verifyAuthToken = (token: string) => verifyToken(token, tokenKey);

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
    ctx.response.status = 401;
  }
};
