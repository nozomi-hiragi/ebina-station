import { WebAuthnAuthenticator } from "../../../utils/webauthn/types.ts";

export type WebAuthnItem = {
  authenticators: { [name: string]: WebAuthnAuthenticator | undefined };
  enableDevices: string[];
};

export type WebAuthn = {
  [origins: string]: WebAuthnItem | undefined;
};
