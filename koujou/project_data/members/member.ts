import { PasswordAuth } from "./auth/password.ts";
import { WebAuthn } from "./auth/webauthn.ts";

type Flags = {
  admin?: boolean;
};

export type Member = {
  name: string;
  auth: {
    password?: PasswordAuth;
    webAuthn?: WebAuthn;
  };
  flags?: Flags;
};
