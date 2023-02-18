import * as OTPAuth from "otpauth";

export type TOTPAuth = {
  secret: string;
};

// deno-lint-ignore no-explicit-any
export const isTOTPAuth = (obj: any): obj is TOTPAuth =>
  "secret" in obj && typeof obj.secret === "string";

export const createTOTPAuth = () => {
  const totpAuth: TOTPAuth = { secret: new OTPAuth.Secret().base32 };
  return totpAuth;
};

const createTOTP = (
  auth: TOTPAuth,
  label?: string,
  issuer = "EbinaStation",
) =>
  new OTPAuth.TOTP({
    label,
    issuer,
    secret: OTPAuth.Secret.fromBase32(auth.secret),
  });

export const authTOTP = (auth: TOTPAuth, token: string) =>
  createTOTP(auth).validate({ token });

export const generateTOTPURI = (
  auth: TOTPAuth,
  label: string,
  issuer?: string,
) => createTOTP(auth, label, issuer).toString();
