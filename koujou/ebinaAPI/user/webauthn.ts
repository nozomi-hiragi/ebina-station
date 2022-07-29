import { oak } from "../../deps.ts";
import { authToken, JwtPayload } from "../../utils/auth.ts";
import { HttpExeption } from "../../utils/utils.ts";
import {
  createLoginOptions,
  createRegistOptions,
  deleteAuthenticators,
  getAuthenticatorNames,
  verifyLoginChallenge,
  verifyRegistChallenge,
} from "../../utils/webauthn/funcs.ts";

const challenges: { [key: string]: string | undefined } = {};

const webauthnRouter = new oak.Router();

// 登録オプション取得
// origin:
// 200 オプション
// 400 オリジンヘッダない
// 404 メンバーがない
// 500 WebAuthnの設定おかしい
webauthnRouter.get("/regist", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload: JwtPayload = ctx.state.payload!;
  const memberId = payload.id;

  try {
    const options = await createRegistOptions(origin, memberId);
    challenges[memberId] = options.challenge;
    ctx.response.body = options;
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

// 登録
// origin:
// { ...credential, deviceName }
// 200 OK
// 400 情報おかしい
// 401 チャレンジ失敗
// 404 メンバーがない
// 409 チャレンジ控えがない
// 410 チャレンジ古い
// 500 WebAuthnの設定おかしい
webauthnRouter.post("/regist", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload: JwtPayload = ctx.state.payload!;
  const memberId = payload.id;

  const body = await ctx.request.body({ type: "json" }).value;
  const { deviceName } = body;
  if (!deviceName) return ctx.response.status = 400;

  const challenge = challenges[memberId];
  if (!challenge) return ctx.response.status = 409;
  delete challenges[memberId];

  try {
    await verifyRegistChallenge(origin, memberId, deviceName, challenge, body);
    ctx.response.status = 200;
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

// 確認用オプション取得
// origin:
// ?names[]
// 200 オプション
// 400 情報足りない
// 404 メンバーがない
// 500 WebAuthnの設定おかしい
webauthnRouter.get("/verify", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload: JwtPayload = ctx.state.payload!;
  const memberId = payload.id;

  const queryDeviceNames = ctx.request.url.searchParams
    .get("deviceNames")?.split(",") ?? [];

  try {
    const options = await createLoginOptions(
      origin,
      memberId,
      queryDeviceNames,
    );
    challenges[memberId] = options.challenge;
    ctx.response.body = options;
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

// 認証
// origin:
// { ...credential }
// 200 OK
// 400 情報おかしい
// 401 チャレンジ失敗
// 404 ものがない
// 405 パスワードが設定されてない
// 409 チャレンジ控えがない
// 410 チャレンジ古い
// 500 WebAuthnの設定おかしい
webauthnRouter.post("/verify", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload: JwtPayload = ctx.state.payload!;
  const memberId = payload.id;

  const body = await ctx.request.body({ type: "json" }).value;

  const challengeItem = challenges[memberId];
  if (!challengeItem) return ctx.response.status = 409;
  delete challenges[payload.id];

  try {
    await verifyLoginChallenge(origin, memberId, challengeItem, body);
    ctx.response.status = 200;
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

// デバイスら情報取得
// origin:
// ?names
// 200 空でも返す
// 400 情報足りない
// 500 WebAuthnの設定おかしい
webauthnRouter.get("/device", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload: JwtPayload = ctx.state.payload!;
  const memberId = payload.id;

  const deviceNames: string[] =
    ctx.request.url.searchParams.get("deviceNames")?.split(",") ?? [];

  try {
    const authenticatorNames = getAuthenticatorNames(origin, memberId);
    ctx.response.body = deviceNames.length === 0
      ? authenticatorNames
      : authenticatorNames.filter((name) => deviceNames.includes(name));
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

// デバイスら削除
// origin:
// :deviceName
// ?names
// 200 OK
// 404 みつからない
// 500 WebAuthnの設定おかしい
webauthnRouter.delete("/device", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload: JwtPayload = ctx.state.payload!;
  const memberId = payload.id;

  const deviceNames = ctx.request.url.searchParams
    .get("deviceNames")?.split(",") ?? [];

  try {
    const failedNames = deleteAuthenticators(origin, memberId, deviceNames);
    if (failedNames.length === 0) {
      ctx.response.status = 200;
    } else if (failedNames.length === deviceNames.length) {
      ctx.response.status = 404;
      ctx.response.body = { message: "Can't find all devices" };
    } else {
      ctx.response.status = 206;
      ctx.response.body = { failedNames: failedNames };
    }
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

// デバイス情報取得
// origin:
// :deviceName
// 200 空でも返す
// 400 情報足りない
// 404 みつからない
// 500 WebAuthnの設定おかしい
webauthnRouter.get("/device/:deviceName", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload!;
  const memberId = payload.id;

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  try {
    const authenticatorNames = getAuthenticatorNames(origin, memberId);
    if (authenticatorNames.includes(deviceName)) {
      ctx.response.body = deviceName;
    } else {
      ctx.response.status = 404;
    }
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

// デバイス削除
// origin:
// :deviceName
// 200 OK
// 404 みつからない
// 500 WebAuthnの設定おかしい
webauthnRouter.delete("/device/:deviceName", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload!;
  const memberId = payload.id;

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  try {
    const failedNames = deleteAuthenticators(origin, memberId, [deviceName]);
    if (failedNames.length) {
      ctx.response.status = 500;
    } else {
      ctx.response.status = 200;
    }
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

export default webauthnRouter;
