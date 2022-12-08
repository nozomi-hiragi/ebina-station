import { oak, TypeUtils } from "../../deps.ts";
import { authToken } from "../../auth_manager/token.ts";
import { Members } from "../../project_data/members/mod.ts";
import { isPushSubscriptionJSON } from "../../project_data/members/webpush.ts";
import { Settings } from "../../project_data/settings/mod.ts";
import { send } from "../../webpush/mod.ts";

const webpushRouter = new oak.Router();

// プッシュ登録状態確認
// 200 結果
// 401 ログインおかしい
// 404 居ない
webpushRouter.get("/subscribed/:name", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const member = Members.instance().getMember(payload.id);
  if (!member) return ctx.response.status = 404;
  const subscription = member.getWebPushDevice(ctx.params.name);
  ctx.response.status = 200;
  if (subscription) {
    ctx.response.body = {
      subscribed: true,
    };
  } else {
    ctx.response.body = {
      subscribed: false,
      applicationServerKey: Settings.instance().WebPush.values.publicKey,
    };
  }
});

// プッシュ登録
// 200 上書き
// 201 新規
// 401 ログインおかしい
// 404 居ない
webpushRouter.post("/device", authToken, async (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const members = Members.instance();
  const member = members.getMember(payload.id);
  if (!member) return ctx.response.status = 404;

  const { deviceName, subscription } = await ctx.request
    .body({ type: "json" }).value;
  if (
    !TypeUtils.isString(deviceName) || !isPushSubscriptionJSON(subscription)
  ) {
    return ctx.response.status = 400;
  }

  const isNew = member.setWPSubscription(deviceName, subscription);
  members.setMember(member);
  ctx.response.status = isNew ? 201 : 200;
});

// 削除
// 200 ok
// 401 ログインおかしい
// 404 居ない
webpushRouter.delete("/device/:name", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const members = Members.instance();
  const member = members.getMember(payload.id);
  if (!member) return ctx.response.status = 404;

  const deviceName = ctx.params.name;
  if (!TypeUtils.isString(deviceName)) return ctx.response.status = 400;

  const webpushSeettings = Settings.instance().WebPush.values;
  const serverProps = {
    ...webpushSeettings,
    contactInfo: webpushSeettings.contactInfo ?? ctx.request.url.origin,
  };
  const subscription = member.getWebPushDevice(deviceName)?.subscription;
  if (!subscription) return ctx.response.status = 406;
  const payloadBuffer = new TextEncoder()
    .encode(
      JSON.stringify({
        title: "Remove this device",
        body: "This device will be remove for push notification",
        action: "unsubscribe",
      }),
    );
  send(serverProps, subscription, payloadBuffer);

  member.deleteWebPushDevice(deviceName);
  members.setMember(member);
  const deviceNames = member.getWebPushDeviceNames() ?? [];

  ctx.response.status = 200;
  ctx.response.body = deviceNames;
});

// 全デバイス名取得
// 200 結果
// 401 ログインおかしい
// 404 居ない
webpushRouter.get("/devices", authToken, (ctx) => {
  const payload = ctx.state.payload;
  if (!payload) return ctx.response.status = 401;
  const member = Members.instance().getMember(payload.id);
  if (!member) return ctx.response.status = 404;
  const deviceNames = member.getWebPushDeviceNames() ?? [];
  ctx.response.status = 200;
  ctx.response.body = deviceNames;
});

// プッシュ送るテスト
// 400 値おかしい
// 401 ログインおかしい
// 404 居ない
// 送信fetchの戻り
webpushRouter.post("/test", authToken, async (ctx) => {
  const jwtpayload = ctx.state.payload;
  if (!jwtpayload) return ctx.response.status = 401;
  const members = Members.instance();
  const member = members.getMember(jwtpayload.id);
  if (!member) return ctx.response.status = 404;
  const body = await ctx.request.body({ type: "json" }).value;
  const { deviceName } = body;
  if (!TypeUtils.isString(deviceName)) return ctx.response.status = 400;

  const webpushSeettings = Settings.instance().WebPush.values;
  const serverProps = {
    ...webpushSeettings,
    contactInfo: webpushSeettings.contactInfo ?? ctx.request.url.origin,
  };

  const subscription = member.getWebPushDevice(deviceName)?.subscription;
  if (!subscription) return ctx.response.status = 406;

  const payloadBuffer = new TextEncoder()
    .encode(
      JSON.stringify({
        title: "WebPush Test",
        body: "This notification is test",
      }),
    );

  const ret = await send(serverProps, subscription, payloadBuffer);
  ctx.response.status = ret.status;
  ctx.response.body = await ret.text();
});

export default webpushRouter;
