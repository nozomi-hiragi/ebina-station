import { oak } from "../../../deps.ts";
import { getMembers } from "../../../project_data/members/members.ts";
import { authToken, JwtPayload } from "../../../utils/auth.ts";
import { HttpExeption } from "../../../utils/utils.ts";
import {
  createOptionsForAuth,
  createOptionsForRegist,
  getRPID,
  verifyChallengeForAuth,
  verifyChallengeForRegist,
} from "../../../utils/webauthn/funcs.ts";
import deviceRouter from "./device.ts";

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
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  try {
    const options = await createOptionsForRegist(origin, member);
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
  const members = getMembers();
  const member = members.getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const body = await ctx.request.body({ type: "json" }).value;
  const { deviceName } = body;
  if (!deviceName) return ctx.response.status = 400;

  try {
    const newMember = await verifyChallengeForRegist(
      origin,
      member,
      deviceName,
      body,
    );
    members.setMember(newMember);
    ctx.response.status = 200;
    ctx.response.body = newMember
      .getWebAuthnItem(getRPID(origin))
      ?.getEnableDeviceNames() ?? [];
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
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const queryDeviceNames = ctx.request.url.searchParams
    .get("deviceNames") ?? "";

  try {
    const options = await createOptionsForAuth(
      origin,
      memberId,
      undefined,
      member,
      queryDeviceNames ? queryDeviceNames.split(",") : undefined,
    );
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
  const member = getMembers().getMember(memberId);
  if (!member) return ctx.response.status = 404;

  const body = await ctx.request.body({ type: "json" }).value;

  try {
    await verifyChallengeForAuth(origin, member, body, memberId);
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

webauthnRouter.use("/device", deviceRouter.routes());

export default webauthnRouter;
