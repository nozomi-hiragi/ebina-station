import * as bcrypt from "bcrypt";

export type PasswordAuth = {
  hash: string;
};

// deno-lint-ignore no-explicit-any
export const isPasswordAuth = (obj: any): obj is PasswordAuth =>
  "hash" in obj && typeof obj.hash === "string";

export const createPasswordAuth = (pass: string) => {
  const passwordAuth: PasswordAuth = { hash: bcrypt.hashSync(pass) };
  return passwordAuth;
};

export const authPassword = (auth: PasswordAuth, pass: string) => {
  return bcrypt.compareSync(pass, auth.hash);
};
