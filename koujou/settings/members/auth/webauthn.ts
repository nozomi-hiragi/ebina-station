import { WebAuthnAuthenticator } from "../../../utils/webauthn/types.ts";

export type WebAuthnItem = {
  authenticators: { [name: string]: WebAuthnAuthenticator | undefined };
  enableDevices: string[];
};

export type WebAuthn = {
  [hostname: string]: WebAuthnItem | undefined;
};

export const hasHostname = (webAuthn: WebAuthn, hostname: string) => {
  return webAuthn[hostname] !== undefined;
};
