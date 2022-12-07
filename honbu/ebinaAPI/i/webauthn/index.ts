import { oak } from "../../../deps.ts";
import { authToken } from "../../../auth_manager/token.ts";
import { getRPID } from "../../../auth_manager/webauthn.ts";
import deviceRouter from "./device.ts";
import {
  AuthManager,
  handleAMErrorToStatus,
} from "../../../auth_manager/mod.ts";
import { randomBase64url } from "../../../utils/utils.ts";

const webauthnRouter = new oak.Router();

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
webauthnRouter.post("/regist", async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  await authToken(ctx, async () => {});
  const payload = ctx.state.payload;
  const body = await ctx.request.body({ type: "json" }).value;
  const id = payload ? payload.id : ctx.request.headers.get("id");
  if (!id) return ctx.response.status = 400;

  try {
    const am = AuthManager.instance();
    if (body.type === "public-key") {
      const enabledDeviceNames = await am
        .registWebAuthnVerify(origin, id, body).then((member) =>
          member.getWebAuthnItem(getRPID(origin))?.getEnableDeviceNames() ?? []
        );
      ctx.response.body = enabledDeviceNames;
      ctx.response.status = 200;
    } else {
      const option = await am.registWebAuthnOption(origin, id, {
        ...body,
        deviceName: body.deviceName ?? randomBase64url(8),
      });
      ctx.response.body = option;
      ctx.response.status = 202;
    }
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
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
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const body = await ctx.request.body({ type: "json" }).value.catch(() => ({}));

  try {
    if (body.type === "public-key") {
      await AuthManager.instance().verifyAuthResponse(origin, payload.id, body);
      ctx.response.status = 200;
    } else {
      const deviceNames = body.deviceNames;
      if (!deviceNames || !Array.isArray(deviceNames)) {
        return ctx.response.status = 400;
      }
      const options = await AuthManager.instance()
        .checkDevicesOption(origin, payload.id, deviceNames);
      ctx.response.body = options;
      ctx.response.status = 202;
    }
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
  }
});

webauthnRouter.use("/device", deviceRouter.routes());

export default webauthnRouter;
