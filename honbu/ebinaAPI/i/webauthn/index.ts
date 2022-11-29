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

// 登録オプション取得
// origin:
// 200 オプション
// 400 オリジンヘッダない
// 404 メンバーがない
// 500 WebAuthnの設定おかしい
webauthnRouter.get("/regist", authToken, async (ctx) => {
  const origin = ctx.request.headers.get("origin");
  if (!origin) return ctx.response.status = 400;
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const deviceName = ctx.request.url.searchParams
    .get("deviceName") ?? randomBase64url(8);

  try {
    const option = await AuthManager.instance()
      .registWebAuthnOption(origin, payload.id, deviceName);
    ctx.response.body = option;
    ctx.response.status = 200;
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
  }
});

// 登録
// origin:
// { credential }
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
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const body = await ctx.request.body({ type: "json" }).value;

  try {
    const enabledDeviceNames = await AuthManager.instance()
      .registWebAuthnVerify(origin, payload.id, body)
      .then((member) =>
        member.getWebAuthnItem(getRPID(origin))?.getEnableDeviceNames() ?? []
      );
    ctx.response.body = enabledDeviceNames;
    ctx.response.status = 200;
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
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
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;

  const queryDeviceNames = ctx.request.url.searchParams
    .get("deviceNames") ?? "";

  try {
    const options = await AuthManager.instance().checkDevicesOption(
      origin,
      payload.id,
      queryDeviceNames ? queryDeviceNames.split(",") : undefined,
    );
    ctx.response.body = options;
    ctx.response.status = 200;
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
  const body = await ctx.request.body({ type: "json" }).value;

  try {
    await AuthManager.instance().verifyAuthResponse(origin, payload.id, body);
    ctx.response.status = 200;
  } catch (err) {
    return ctx.response.status = handleAMErrorToStatus(err);
  }
});

webauthnRouter.use("/device", deviceRouter.routes());

export default webauthnRouter;
