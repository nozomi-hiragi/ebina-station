import { base64url, djwt } from "../deps.ts";
import ece from "./ece/mod.ts";

const DEFAULT_TTL = 60 * 60 * 24 * 28;
type UrgencyType = "very-low" | "low" | "normal" | "high";

const createAuth = async (
  publicKey: string,
  privateKey: string,
  endpoint: string,
  contactInfo: string,
) => {
  const parsedUrl = new URL(endpoint);
  const aud = parsedUrl.protocol + "//" + parsedUrl.host;

  const publicKeyBinary = base64url.decode(publicKey);
  const jwt = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64url.encode(publicKeyBinary.subarray(1, 33)),
      y: base64url.encode(publicKeyBinary.subarray(33, 65)),
      d: privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  ).then((privateKey) =>
    djwt.create({ typ: "JWT", alg: "ES256" }, {
      aud,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: contactInfo,
    }, privateKey)
  );

  return `vapid t=${jwt}, k=${publicKey}`;
};

export const send = async (
  serverProps: { publicKey: string; privateKey: string; contactInfo: string },
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: Uint8Array,
  options: { TTL: number; topic?: string; urgency?: UrgencyType } = {
    TTL: DEFAULT_TTL,
  },
) => {
  const body = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  ).then((localKey) =>
    ece.encrypt(payload, {
      dh: subscription.keys.p256dh,
      localKey: localKey,
      authSecret: subscription.keys.auth,
    })
  );
  const auth = await createAuth(
    serverProps.publicKey,
    serverProps.privateKey,
    subscription.endpoint,
    serverProps.contactInfo,
  );
  const headers: Record<string, string> = {
    "Content-Encoding": "aes128gcm",
    TTL: options.TTL.toString(),
    Authorization: auth,
  };
  if (options.topic) headers["Topic"] = options.topic;
  if (options.urgency) headers["Urgency"] = options.urgency;
  return fetch(subscription.endpoint, { method: "POST", body, headers });
};
