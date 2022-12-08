import {
  authPassword,
  createPasswordAuth,
  PasswordAuth,
} from "./auth/password.ts";
import {
  authTOTP,
  createTOTPAuth,
  generateTOTPURI,
  TOTPAuth,
} from "./auth/totp.ts";
import {
  hasHostname,
  WebAuthn,
  WebAuthnItemController,
} from "./auth/webauthn.ts";
import { PushSubscriptionJSON, WebPushParams } from "./webpush.ts";

type Flags = {
  admin?: boolean;
};

export interface MemberValues {
  name: string;
  auth: {
    password?: PasswordAuth;
    webAuthn?: WebAuthn;
    totpAuth?: TOTPAuth;
  };
  webpush?: WebPushParams;
  flags?: Flags;
}

export class Member {
  private id: string;
  private value: MemberValues;
  private challengeWebAuthn?: { name: string; challenge: string };
  private tempTOTP?: TOTPAuth;

  constructor(id: string, value: MemberValues) {
    this.id = id;
    this.value = value;
  }

  getId = () => this.id;
  getRawValue = () => this.value;
  getValue = () => ({ ...(this.value), auth: undefined, webpush: undefined });
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

  getWebPushDeviceNames() {
    return this.value.webpush
      ? Object.keys(this.value.webpush.devices)
      : undefined;
  }

  getWebPushDevice(name: string) {
    return this.value.webpush?.devices[name];
  }

  deleteWebPushDevice(name: string) {
    if (!this.value.webpush) return undefined;
    if (this.value.webpush.devices[name]) {
      delete this.value.webpush.devices[name];
      return true;
    }
    return false;
  }

  setWPSubscription(name: string, subscription: PushSubscriptionJSON) {
    if (!this.value.webpush) this.value.webpush = { devices: {} };
    const device = this.value.webpush.devices[name];
    this.value.webpush.devices[name] = { ...device, subscription };
    return device !== undefined;
  }

  generateTempTOTP() {
    this.tempTOTP = createTOTPAuth();
    return generateTOTPURI(this.tempTOTP, this.getName());
  }

  registTempTOTP(code: string) {
    if (!this.tempTOTP) return false;
    const ret = authTOTP(this.tempTOTP, code);
    if (ret === null) return false;
    this.value.auth.totpAuth = this.tempTOTP;
    this.tempTOTP = undefined;
    return true;
  }

  verifyTOTP(code: string) {
    const totpAuth = this.value.auth.totpAuth;
    if (!totpAuth) return undefined;
    const ret = authTOTP(totpAuth, code);
    if (ret === null) return false;
    return true;
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
