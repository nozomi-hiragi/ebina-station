import {
  authPassword,
  createPasswordAuth,
  PasswordAuth,
} from "./auth/password.ts";
import {
  hasHostname,
  WebAuthn,
  WebAuthnItemController,
} from "./auth/webauthn.ts";

type Flags = {
  admin?: boolean;
};

export interface MemberValues {
  name: string;
  auth: {
    password?: PasswordAuth;
    webAuthn?: WebAuthn;
  };
  flags?: Flags;
}

export class Member {
  private id: string;
  private value: MemberValues;
  private challengeWebAuthn?: { name: string; challenge: string };

  constructor(id: string, value: MemberValues) {
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
    const item = this.value.auth.webAuthn[rpID];
    if (!item) return undefined;
    return new WebAuthnItemController(item);
  }

  setWebAuthnItem(rpID: string, webAuthnItem: WebAuthnItemController) {
    if (!this.value.auth.webAuthn) this.value.auth.webAuthn = {};
    if (webAuthnItem.hasAuthenticator()) {
      this.value.auth.webAuthn[rpID] = webAuthnItem.getRawItem();
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

  setChallengeWebAuthn(name: string, challenge: string) {
    this.challengeWebAuthn = { name, challenge };
  }

  getChallengeWebAuthn() {
    return this.challengeWebAuthn;
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
