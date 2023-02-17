import { oak } from "../../../deps.ts";
import { Members } from "../../../project_data/members/mod.ts";
import { authToken, JwtPayload } from "../../../auth_manager/token.ts";
import { HttpException } from "../../../utils/utils.ts";
import { getRPID } from "../../../auth_manager/webauthn.ts";
import {
  AuthManager,
  AuthManagerError,
  handleAMErrorToStatus,
} from "../../../auth_manager/mod.ts";
import { Member } from "../../../project_data/members/member.ts";
import { isString } from "https://deno.land/std@0.166.0/encoding/_yaml/utils.ts";

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
    if (err instanceof HttpException) {
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
    if (err instanceof HttpException) {
      ctx.response.status = err.status;
      ctx.response.body = err.message;
    } else {
      throw err;
    }
  }
});

// WebAuthnデバイス削除
// origin:
// :deviceName
// 200 OK
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.post("/:deviceName/delete", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload!;
  const body = await ctx.request.body({ type: "json" }).value.catch(() => ({}));

  const { deviceName } = ctx.params;
  if (!deviceName) return ctx.response.status = 400;
  const key = payload.id + deviceName;

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      await am.verifyAuthResponse(origin, payload.id, body, key);
      return ctx.response.status = 200;
    }

    const member = Members.instance().getMember(payload.id);
    if (!member) return ctx.response.status = 404;
    const rpID = getRPID(origin);

    const deleteDevice = (member: Member) => {
      const webAuthnItem = member.getWebAuthnItem(rpID);
      if (!webAuthnItem) throw new AuthManagerError("No WebAuthn auth");
      const ret = webAuthnItem.deleteAuthenticator(deviceName);
      if (!ret) throw new AuthManagerError("No WebAuthn auth");
      member.setWebAuthnItem(rpID, webAuthnItem);
      Members.instance().setMember(member);
    };

    if (body.type === "password") {
      const { pass, code } = body;
      if (!pass || !isString(pass) || !code || !isString(code)) {
        return ctx.response.status = 400;
      }
      const verifyPass = member.authMemberWithPassword(pass);
      if (verifyPass === undefined) {
        throw new AuthManagerError("No password auth");
      }
      const verifyTOTP = member.verifyTOTP(code);
      if (verifyTOTP === undefined) {
        throw new AuthManagerError("No TOTP auth");
      }
      if (!verifyPass || !verifyTOTP) throw new AuthManagerError("Failed auth");
      deleteDevice(member);
      ctx.response.status = 200;
    } else {
      const option = await am.createAuthOption(origin, key, {
        id: payload.id,
        action: (member) => Promise.resolve(deleteDevice(member)),
      });
      ctx.response.body = option;
      ctx.response.status = 202;
    }
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
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
    if (err instanceof HttpException) {
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
