import { WebAuthnAuthenticator } from "../../../utils/webauthn/types.ts";

export type WebAuthnItem = {
  authenticators: { [name: string]: WebAuthnAuthenticator | undefined };
};

export type WebAuthn = {
  [origins: string]: WebAuthnItem | undefined;
};
