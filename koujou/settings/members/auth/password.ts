import { bcrypt } from "../../../deps.ts";

export type PasswordAuth = {
  hash: string;
};

export const createPasswordAuth = (pass: string) => {
  const passwordAuth: PasswordAuth = { hash: bcrypt.hashSync(pass) };
  return passwordAuth;
};

export const authPassword = (auth: PasswordAuth, pass: string) => {
  return bcrypt.compareSync(pass, auth.hash);
};
