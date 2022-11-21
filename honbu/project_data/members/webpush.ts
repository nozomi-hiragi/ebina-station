import { isObject } from "https://deno.land/std@0.158.0/encoding/_yaml/utils.ts";
import { isString } from "../../deps.ts";

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
  if (!value.endpoint || !isString(value.endpoint)) return false;
  if (!value.keys || !isObject(value.keys)) return false;
  if (!value.keys.p256dh || !isString(value.keys.p256dh)) return false;
  if (!value.keys.auth || !isString(value.keys.auth)) return false;
  return true;
};

export interface WebPushParams {
  devices: {
    [name: string]: {
      subscription: PushSubscriptionJSON;
    } | undefined;
  };
}
