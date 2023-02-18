import { isString } from "std/encoding/_yaml/utils.ts";
import { Hono } from "hono/mod.ts";
import { StatusCode } from "hono/utils/http-status.ts";
import { authToken, JwtPayload } from "../../auth_manager/token.ts";
import { Members } from "../../project_data/members/mod.ts";
import {
  isPushSubscriptionJSON,
  PushSubscriptionJSON,
} from "../../project_data/members/webpush.ts";
import { Settings } from "../../project_data/settings/mod.ts";
import { send } from "../../webpush/mod.ts";

const webpushRouter = new Hono();

// プッシュ登録状態確認
// 200 結果
// 401 ログインおかしい
// 404 居ない
webpushRouter.get("/subscribed/:name", authToken, (c) => {
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const member = Members.instance().getMember(payload.id);
  if (!member) return c.json({}, 404);
  const subscription = member.getWebPushDevice(c.req.param().name);
  const body = subscription ? { subscribed: true } : {
    subscribed: false,
    applicationServerKey: Settings.instance().WebPush.values.publicKey,
  };
  return c.json(body, 200);
});

// プッシュ登録
// 200 上書き
// 201 新規
// 401 ログインおかしい
// 404 居ない
webpushRouter.post("/device", authToken, async (c) => {
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const members = Members.instance();
  const member = members.getMember(payload.id);
  if (!member) return c.json({}, 404);

  const { deviceName, subscription } = await c.req.json<
    { deviceName: string; subscription: PushSubscriptionJSON }
  >();
  if (!isString(deviceName) || !isPushSubscriptionJSON(subscription)) {
    return c.json({}, 400);
  }

  const isNew = member.setWPSubscription(deviceName, subscription);
  members.setMember(member);
  return c.json({}, isNew ? 201 : 200);
});

// 削除
// 200 ok
// 401 ログインおかしい
// 404 居ない
webpushRouter.delete("/device/:name", authToken, (c) => {
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const members = Members.instance();
  const member = members.getMember(payload.id);
  if (!member) return c.json({}, 404);

  const deviceName = c.req.param().name;
  if (!isString(deviceName)) return c.json({}, 400);

  const webpushSeettings = Settings.instance().WebPush.values;
  const serverProps = {
    ...webpushSeettings,
    contactInfo: webpushSeettings.contactInfo ??
      (c.req.headers.get("origin") ?? ""),
  };
  const subscription = member.getWebPushDevice(deviceName)?.subscription;
  if (!subscription) return c.json({}, 406);
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

  return c.json(deviceNames, 200);
});

// 全デバイス名取得
// 200 結果
// 401 ログインおかしい
// 404 居ない
webpushRouter.get("/devices", authToken, (c) => {
  const payload = c.get<JwtPayload>("payload");
  if (!payload) return c.json({}, 401);
  const member = Members.instance().getMember(payload.id);
  if (!member) return c.json({}, 404);
  const deviceNames = member.getWebPushDeviceNames() ?? [];
  return c.json(deviceNames, 200);
});

// プッシュ送るテスト
// 400 値おかしい
// 401 ログインおかしい
// 404 居ない
// 送信fetchの戻り
webpushRouter.post("/test", authToken, async (c) => {
  const jwtpayload = c.get<JwtPayload>("payload");
  if (!jwtpayload) return c.json({}, 401);
  const members = Members.instance();
  const member = members.getMember(jwtpayload.id);
  if (!member) return c.json({}, 404);
  const body = await c.req.json<{ deviceName: string }>();
  const { deviceName } = body;
  if (!isString(deviceName)) return c.json({}, 400);

  const webpushSeettings = Settings.instance().WebPush.values;
  const serverProps = {
    ...webpushSeettings,
    contactInfo: webpushSeettings.contactInfo ??
      (c.req.headers.get("origin") ?? ""),
  };

  const subscription = member.getWebPushDevice(deviceName)?.subscription;
  if (!subscription) return c.json({}, 406);

  const payloadBuffer = new TextEncoder()
    .encode(
      JSON.stringify({
        title: "WebPush Test",
        body: "This notification is test",
      }),
    );

  const ret = await send(serverProps, subscription, payloadBuffer);
  return c.json(await ret.text(), ret.status as StatusCode);
});

export default webpushRouter;
