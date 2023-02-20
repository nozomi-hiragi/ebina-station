import { Hono } from "hono/mod.ts";
import { authToken, AuthTokenVariables } from "../../../auth_manager/token.ts";
import { getRPID } from "../../../auth_manager/webauthn.ts";
import deviceRouter from "./device.ts";
import {
  AuthManager,
  handleAMErrorToStatus,
} from "../../../auth_manager/mod.ts";
import { randomBase64url } from "../../../utils/utils.ts";
import {
  AttestationResponseJSON,
  AuthenticationResponseJSON,
} from "../../../webauthn/fido2Wrap.ts";

const webauthnRouter = new Hono<{ Variables: AuthTokenVariables }>();

// 登録
// origin:
// { credential }
// 200 OK
// 400 オリジンヘッダない
// 401 チャレンジ失敗
// 404 メンバーがない
// 409 チャレンジ控えがない
// 410 チャレンジ古い
// 500 WebAuthnの設定おかしい
webauthnRouter.post("/regist", async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  await authToken(c, async () => {});
  const payload = c.get("payload");
  const body = await c.req.json<
    AttestationResponseJSON & {
      type: string;
      deviceName?: string;
      pass: string;
      code: string;
    }
  >();
  const id = payload ? payload.id : c.req.headers.get("id");
  if (!id) return c.json({}, 400);

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const enabledDeviceNames = await am
        .registWebAuthnVerify(origin, id, body).then((member) =>
          member.getWebAuthnItem(getRPID(origin))?.getEnableDeviceNames() ?? []
        );
      return c.json(enabledDeviceNames, 200);
    } else {
      const option = await am.registWebAuthnOption(origin, id, {
        ...body,
        deviceName: body.deviceName ?? randomBase64url(8),
      });
      return c.json(option, 202);
    }
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
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
webauthnRouter.post("/verify", authToken, async (c) => {
  const origin = c.req.headers.get("origin");
  if (!origin) return c.json({}, 400);
  const payload = c.get("payload");
  if (!payload) return c.json({}, 401);
  const body = await c.req.json<
    | ({ type: "public-key" } & AuthenticationResponseJSON)
    | { deviceNames?: string[] }
  >().catch(() => ({}));

  try {
    if ("type" in body && body.type === "public-key") {
      await AuthManager.instance().verifyAuthResponse(origin, payload.id, body);
      return c.json({}, 200);
    }
    const deviceNames = "deviceNames" in body ? body.deviceNames : undefined;
    if (!deviceNames || !Array.isArray(deviceNames)) {
      return c.json({}, 400);
    }
    const options = await AuthManager.instance()
      .checkDevicesOption(origin, payload.id, deviceNames);
    return c.json(options, 202);
  } catch (err) {
    return c.json({}, handleAMErrorToStatus(err));
  }
});

webauthnRouter.route("/device", deviceRouter);

export default webauthnRouter;
