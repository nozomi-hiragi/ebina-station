import { TypeUtils } from "../../deps.ts";

export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}
export const isPushSubscriptionJSON = (
  // deno-lint-ignore no-explicit-any
  value: any,
): value is PushSubscriptionJSON => {
  if (!value.endpoint || !TypeUtils.isString(value.endpoint)) return false;
  if (!value.keys || !TypeUtils.isObject(value.keys)) return false;
  if (!value.keys.p256dh || !TypeUtils.isString(value.keys.p256dh)) {
    return false;
  }
  if (!value.keys.auth || !TypeUtils.isString(value.keys.auth)) return false;
  return true;
};

export interface WebPushParams {
  devices: {
    [name: string]: {
      subscription: PushSubscriptionJSON;
    } | undefined;
  };
}
