import { oak } from "../../../../deps.ts";
import { getMembers } from "../../../../settings/members/members.ts";
import { authToken, JwtPayload } from "../../../../utils/auth.ts";
import { HttpExeption } from "../../../../utils/utils.ts";
import {
  deleteAuthenticators,
  disableAuthenticator,
  enableAuthenticator,
  getAuthenticatorNames,
  getEnableAuthenticators,
} from "../../../../utils/webauthn/funcs.ts";

const deviceRouter = new oak.Router();

// デバイスら情報取得
// origin:
// ?names
// 200 空でも返す
// 400 情報足りない
// 500 WebAuthnの設定おかしい
deviceRouter.get("/", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload: JwtPayload = ctx.state.payload!;
  const memberId = payload.id;
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const deviceNames: string[] =
    ctx.request.url.searchParams.get("deviceNames")?.split(",") ?? [];

  try {
    const authenticatorNames = getAuthenticatorNames(origin, member);
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
deviceRouter.delete("/", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload: JwtPayload = ctx.state.payload!;
  const memberId = payload.id;
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const deviceNames = ctx.request.url.searchParams
    .get("deviceNames")?.split(",") ?? [];

  try {
    const failedNames = deleteAuthenticators(origin, member, deviceNames);
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
deviceRouter.get("/:deviceName", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload!;
  const memberId = payload.id;
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  try {
    const authenticatorNames = getAuthenticatorNames(origin, member);
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
deviceRouter.delete("/:deviceName", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload!;
  const memberId = payload.id;
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  try {
    const failedNames = deleteAuthenticators(origin, member, [deviceName]);
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

// デバイス有効確認
// origin:
// :deviceName
// 200 こたえ
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.get("/:deviceName/enable", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload!;
  const memberId = payload.id;
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  try {
    const enableDevices = getEnableAuthenticators(origin, member);
    ctx.response.body = enableDevices.includes(deviceName);
  } catch (err) {
    if (err instanceof HttpExeption) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

// デバイス有効
// origin:
// :deviceName
// 200 OK
// 208 もうある
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.post("/:deviceName/enable", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload!;
  const memberId = payload.id;
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  try {
    if (enableAuthenticator(origin, member, deviceName)) {
      ctx.response.status = 200;
    } else {
      ctx.response.status = 208;
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

// デバイス無効
// origin:
// :deviceName
// 200 OK
// 208 もうない
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.post("/:deviceName/disable", authToken, (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload!;
  const memberId = payload.id;
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  try {
    if (disableAuthenticator(origin, member, deviceName)) {
      ctx.response.status = 200;
    } else {
      ctx.response.status = 208;
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

export default deviceRouter;
