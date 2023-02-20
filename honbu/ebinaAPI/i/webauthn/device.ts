import { isString } from "std/encoding/_yaml/utils.ts";
import { Hono } from "hono/mod.ts";
import { Members } from "../../../project_data/members/mod.ts";
import { authToken, AuthTokenVariables } from "../../../auth_manager/token.ts";
import { HttpException } from "../../../utils/utils.ts";
import { getRPID } from "../../../auth_manager/webauthn.ts";
import {
  AuthManager,
  AuthManagerError,
  handleAMErrorToStatus,
} from "../../../auth_manager/mod.ts";
import { Member } from "../../../project_data/members/member.ts";
import { AuthenticationResponseJSON } from "../../../webauthn/fido2Wrap.ts";

const deviceRouter = new Hono<{ Variables: AuthTokenVariables }>();

// デバイスら情報取得
// origin:
// ?names
// 200 空でも返す
// 400 情報足りない
// 500 WebAuthnの設定おかしい
deviceRouter.get("/", authToken, (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get("payload")!;
  const memberId = payload.id;
  const member = Members.instance().getMember(memberId);
  if (!member) return c.json({}, 404);

  const deviceNames: string[] = c.req.query("deviceNames")?.split(",") ?? [];

  try {
    const rpID = getRPID(origin);
    const webatuhnItem = member.getWebAuthnItem(rpID);
    const authenticatorNames = webatuhnItem?.getAuthenticatorNames() ?? [];

    return c.json(
      deviceNames.length === 0
        ? authenticatorNames
        : authenticatorNames.filter((name) => deviceNames.includes(name)),
    );
  } catch (err) {
    if (err instanceof HttpException) {
      return c.json(err, err.status);
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
deviceRouter.get("/:deviceName", authToken, (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get("payload")!;
  const memberId = payload.id;
  const member = Members.instance().getMember(memberId);
  if (!member) return c.json({}, 404);

  const { deviceName } = c.req.param();
  if (!deviceName) return c.json({}, 400);

  try {
    const rpID = getRPID(origin);
    const webatuhnItem = member.getWebAuthnItem(rpID);
    const authenticatorNames = webatuhnItem?.getAuthenticatorNames() ?? [];

    if (authenticatorNames.includes(deviceName)) {
      return c.json({ deviceName });
    } else {
      return c.json({}, 404);
    }
  } catch (err) {
    if (err instanceof HttpException) {
      return c.json(err, err.status);
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
deviceRouter.post("/:deviceName/delete", authToken, async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get("payload");
  const body = await c.req.json<
    | ({ type: "public-key" } & AuthenticationResponseJSON)
    | { type: "password"; pass: string; code: string }
  >().catch(() => ({}));

  const { deviceName } = c.req.param();
  if (!deviceName) return c.json({}, 400);
  const key = payload.id + deviceName;

  try {
    const am = AuthManager.instance();
    if ("type" in body && body.type === "public-key") {
      await am.verifyAuthResponse(origin, payload.id, body, key);
      return c.json({}, 200);
    }

    const member = Members.instance().getMember(payload.id);
    if (!member) return c.json({}, 404);
    const rpID = getRPID(origin);

    const deleteDevice = (member: Member) => {
      const webAuthnItem = member.getWebAuthnItem(rpID);
      if (!webAuthnItem) throw new AuthManagerError("No WebAuthn auth");
      const ret = webAuthnItem.deleteAuthenticator(deviceName);
      if (!ret) throw new AuthManagerError("No WebAuthn auth");
      member.setWebAuthnItem(rpID, webAuthnItem);
      Members.instance().setMember(member);
    };

    if ("type" in body && body.type === "password") {
      const { pass, code } = body;
      if (!pass || !isString(pass) || !code || !isString(code)) {
        return c.json({}, 400);
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
      return c.json({}, 200);
    } else {
      const option = await am.createAuthOption(origin, key, {
        id: payload.id,
        action: (member) => Promise.resolve(deleteDevice(member)),
      });
      return c.json(option, 202);
    }
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

// デバイス有効確認
// origin:
// :deviceName
// 200 こたえ
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.get("/:deviceName/enable", authToken, (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get("payload");
  const memberId = payload.id;
  const member = Members.instance().getMember(memberId);
  if (!member) return c.json({}, 404);
  const { deviceName } = c.req.param();

  const rpID = getRPID(origin);
  try {
    const webAuthnItem = member.getWebAuthnItem(rpID);
    if (!webAuthnItem) {
      return c.json({ message: "Disable WebAuthn on this account" }, 405);
    }
    const enableDevices = webAuthnItem.getRawEnableDeviceNames();
    return c.json(enableDevices.includes(deviceName));
  } catch (err) {
    if (err instanceof HttpException) {
      return c.json(err, err.status);
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
deviceRouter.post("/:deviceName/enable", authToken, (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get("payload");
  const memberId = payload.id;
  const member = Members.instance().getMember(memberId);
  if (!member) return c.json({}, 404);
  const { deviceName } = c.req.param();

  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  if (!webAuthnItem) {
    return c.json({ message: "Disable WebAuthn on this account" }, 405);
  }

  const authenticatorNames = webAuthnItem.getAuthenticatorNames() ?? [];
  if (!authenticatorNames.includes(deviceName)) {
    return c.json({ message: "not found this device" }, 404);
  }

  if (webAuthnItem.hasEnableDeviceName(deviceName) === true) {
    return c.json({}, 208);
  } else {
    webAuthnItem.addEnableDeviceName(deviceName);
    member.setWebAuthnItem(rpID, webAuthnItem);
    Members.instance().setMember(member);
    return c.json({}, 200);
  }
});

// デバイス無効
// origin:
// :deviceName
// 200 OK
// 208 もうない
// 404 みつからない
// 500 WebAuthnの設定おかしい
deviceRouter.post("/:deviceName/disable", authToken, (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get("payload");
  const memberId = payload.id;
  const member = Members.instance().getMember(memberId);
  if (!member) return c.json({}, 404);
  const { deviceName } = c.req.param();

  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  if (!webAuthnItem) {
    return c.json({ message: "Disable WebAuthn on this account" }, 405);
  }

  const authenticatorNames = webAuthnItem.getAuthenticatorNames() ?? [];
  if (!authenticatorNames.includes(deviceName)) {
    return c.json({ message: "not found this device" }, 404);
  }

  if (webAuthnItem.hasEnableDeviceName(deviceName) === false) {
    return c.json({}, 208);
  } else {
    webAuthnItem.deleteEnableDeviceName(deviceName);
    member.setWebAuthnItem(rpID, webAuthnItem);
    Members.instance().setMember(member);
    return c.json({}, 200);
  }
});

export default deviceRouter;
