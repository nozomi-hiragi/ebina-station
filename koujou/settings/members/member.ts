import {
  authPassword,
  createPasswordAuth,
  PasswordAuth,
} from "./auth/password.ts";
import { hasHostname, WebAuthn, WebAuthnItem } from "./auth/webauthn.ts";

type Flags = {
  admin?: boolean;
};

export type _TypeMember = {
  name: string;
  auth: {
    password?: PasswordAuth;
    webAuthn?: WebAuthn;
  };
  flags?: Flags;
};

export class Member {
  private id: string;
  private value: _TypeMember;

  constructor(id: string, value: _TypeMember) {
    this.id = id;
    this.value = value;
  }

  getId = () => this.id;
  getRawValue = () => this.value;
  getValue = () => ({ ...(this.value), auth: undefined });
  getName = () => this.value.name;

  hasWebAuthnAuth = () => this.value.auth.webAuthn !== undefined;
  getWebAuthnItem(rpID: string) {
    if (!this.value.auth.webAuthn) return undefined;
    return this.value.auth.webAuthn[rpID];
  }

  setWebAuthnItem(rpID: string, webAuthnItem: WebAuthnItem) {
    if (!this.value.auth.webAuthn) this.value.auth.webAuthn = {};
    if (Object.values(webAuthnItem.authenticators).length) {
      this.value.auth.webAuthn[rpID] = webAuthnItem;
    } else {
      delete this.value.auth.webAuthn[rpID];
    }
    if (Object.values(this.value.auth.webAuthn).length === 0) {
      delete this.value.auth.webAuthn;
    }
  }

  setPassword(password: PasswordAuth) {
    this.value.auth.password = password;
  }

  cleanFlags() {
    const flags = this.value.flags;
    if (!flags) return;
    if (flags.admin === false) delete flags.admin;
    const hasAny = flags.admin;
    if (hasAny) delete this.value.flags;
  }

  setAdmin(value: boolean) {
    if (this.value.flags) this.value.flags.admin = value;
    else if (value) this.value.flags = { admin: value } as Flags;
    this.cleanFlags();
  }

  authMemberWithPassword(pass: string) {
    const passwordAuth = this.value.auth.password;
    if (!passwordAuth) return undefined;
    return authPassword(passwordAuth, pass);
  }

  updatePassword(current: string, _new: string) {
    const ret = this.authMemberWithPassword(current);
    if (ret) this.setPassword(createPasswordAuth(_new));
    return ret;
  }

  hasWebAuthn(hostname: string) {
    const webauthnAuth = this.value.auth.webAuthn;
    if (!webauthnAuth) return undefined;
    return hasHostname(webauthnAuth, hostname);
  }

  static create(id: string, name: string, pass: string, admin = false) {
    const member = new Member(id, {
      name,
      auth: { password: createPasswordAuth(pass) },
    });
    member.setAdmin(admin);
    return member;
  }
}
