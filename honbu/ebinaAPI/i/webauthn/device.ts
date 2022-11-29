import { oak } from "../../../deps.ts";
import { Members } from "../../../project_data/members/mod.ts";
import { authToken, JwtPayload } from "../../../auth_manager/token.ts";
import { HttpExeption } from "../../../utils/utils.ts";
import { getRPID } from "../../../auth_manager/webauthn.ts";

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
  const member = Members.instance().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const deviceNames: string[] =
    ctx.request.url.searchParams.get("deviceNames")?.split(",") ?? [];

  try {
    const rpID = getRPID(origin);
    const webatuhnItem = member.getWebAuthnItem(rpID);
    const authenticatorNames = webatuhnItem?.getAuthenticatorNames() ?? [];

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
  const member = Members.instance().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const deviceNames = ctx.request.url.searchParams
    .get("deviceNames")?.split(",");

  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  if (!webAuthnItem) {
    ctx.response.status = 405;
    ctx.response.body = "Disable WebAuthn on this account";
    return;
  }
  const authenticatorNames = webAuthnItem.getAuthenticatorNames() ?? [];
  if (authenticatorNames.length === 0) {
    ctx.response.status = 404;
    ctx.response.body = "Disable WebAuthn on this account";
    return;
  }
  const failedNames: string[] = [];
  authenticatorNames.forEach((name) => {
    const isTarget = deviceNames?.includes(name) ?? true;
    if (!isTarget) return;
    if (!webAuthnItem.deleteAuthenticator(name)) {
      failedNames.push(name);
    }
  });
  member.setWebAuthnItem(rpID, webAuthnItem);
  Members.instance().setMember(member);
  if (failedNames.length === 0) {
    ctx.response.status = 200;
  } else if (failedNames.length === deviceNames?.length) {
    ctx.response.status = 404;
    ctx.response.body = { message: "Can't find all devices" };
  } else {
    ctx.response.status = 206;
    ctx.response.body = { failedNames: failedNames };
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
  const member = Members.instance().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  try {
    const rpID = getRPID(origin);
    const webatuhnItem = member.getWebAuthnItem(rpID);
    const authenticatorNames = webatuhnItem?.getAuthenticatorNames() ?? [];

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
  const member = Members.instance().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;

  const rpID = getRPID(origin);
  try {
    const webAuthnItem = member.getWebAuthnItem(rpID);
    if (!webAuthnItem) {
      ctx.response.status = 405;
      ctx.response.body = "Disable WebAuthn on this account";
      return;
    }

    const ret = webAuthnItem.deleteAuthenticator(deviceName);
    member.setWebAuthnItem(rpID, webAuthnItem);
    Members.instance().setMember(member);

    if (ret) {
      ctx.response.status = 200;
    } else {
      ctx.response.status = 500;
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
  const member = Members.instance().getMember(memberId);
  if (!member) return ctx.response.status = 404;
  const { deviceName } = ctx.params;

  const rpID = getRPID(origin);
  try {
    const webAuthnItem = member.getWebAuthnItem(rpID);
    if (!webAuthnItem) {
      ctx.response.status = 405;
      ctx.response.body = "Disable WebAuthn on this account";
      return;
    }
    const enableDevices = webAuthnItem.getRawEnableDeviceNames();
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
  const member = Members.instance().getMember(memberId);
  if (!member) return ctx.response.status = 404;
  const { deviceName } = ctx.params;

  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  if (!webAuthnItem) {
    ctx.response.status = 405;
    ctx.response.body = "Disable WebAuthn on this account";
    return;
  }

  const authenticatorNames = webAuthnItem.getAuthenticatorNames() ?? [];
  if (!authenticatorNames.includes(deviceName)) {
    ctx.response.status = 404;
    ctx.response.body = "not found this device";
    return;
  }

  if (webAuthnItem.hasEnableDeviceName(deviceName) === true) {
    ctx.response.status = 208;
    return;
  } else {
    webAuthnItem.addEnableDeviceName(deviceName);
    member.setWebAuthnItem(rpID, webAuthnItem);
    Members.instance().setMember(member);
    ctx.response.status = 200;
    return;
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
  const member = Members.instance().getMember(memberId);
  if (!member) return ctx.response.status = 404;
  const { deviceName } = ctx.params;

  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  if (!webAuthnItem) {
    ctx.response.status = 405;
    ctx.response.body = "Disable WebAuthn on this account";
    return;
  }

  const authenticatorNames = webAuthnItem.getAuthenticatorNames() ?? [];
  if (!authenticatorNames.includes(deviceName)) {
    ctx.response.status = 404;
    ctx.response.body = "not found this device";
    return;
  }

  if (webAuthnItem.hasEnableDeviceName(deviceName) === false) {
    ctx.response.status = 208;
    return;
  } else {
    webAuthnItem.deleteEnableDeviceName(deviceName);
    member.setWebAuthnItem(rpID, webAuthnItem);
    Members.instance().setMember(member);
    ctx.response.status = 200;
    return;
  }
});

export default deviceRouter;
