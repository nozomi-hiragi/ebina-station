import { createPasswordAuth } from "../project_data/members/auth/password.ts";
import { Member } from "../project_data/members/member.ts";
import { Members } from "../project_data/members/mod.ts";
import { Settings } from "../project_data/settings/mod.ts";
import { logEbina } from "../utils/log.ts";
import { randomBase64url } from "../utils/utils.ts";
import {
  AttestationResponseJSON,
  AuthenticationResponseJSON,
} from "../webauthn/fido2Wrap.ts";
import { generateTokens } from "./token.ts";
import {
  createOptionsForAuth,
  createOptionsForRegist,
  getRPID,
  verifyChallengeForAuth,
  verifyChallengeForRegist,
} from "./webauthn.ts";
import { PublicKeyCredentialDescriptor } from "../webauthn/types.ts";

export type AuthManagerErrorType =
  | "No member"
  | "Failed auth"
  | "No password auth"
  | "No WebAuthn auth"
  | "No TOTP auth"
  | "WebAuthn Enabled"
  | "Wrong rpId"
  | "No matching session id"
  | "Already used device name"
  | "Already used id"
  | "No pre request"
  | "Expired";

export class AuthManagerError extends Error {
  type: AuthManagerErrorType;
  constructor(type: AuthManagerErrorType) {
    super(type);
    this.type = type;
  }
}

const convertAMErrorToStatus = (error: AuthManagerError) => {
  switch (error.type) {
    case "No member":
      return { status: 404, message: error.type };
    case "Failed auth":
      return { status: 403, message: error.type };
    case "No password auth":
      return { status: 405, message: error.type };
    case "No WebAuthn auth":
      return { status: 405, message: error.type };
    case "No TOTP auth":
      return { status: 405, message: error.type };
    case "WebAuthn Enabled":
      return { status: 406, message: error.type };
    case "Wrong rpId":
      return { status: 406, message: error.type };
    case "No matching session id":
      return { status: 400, message: error.type };
    case "Already used device name":
      return { status: 409, message: error.type };
    case "Already used id":
      return { status: 409, message: error.type };
    case "No pre request":
      return { status: 404, message: error.type };
    default:
      return { status: 500, message: error.type };
  }
};

export const handleAMErrorToStatus = (err: Error) => {
  if (err instanceof AuthManagerError) {
    const ret = convertAMErrorToStatus(err);
    if (ret.status !== 500) {
      return ret.status;
    }
  }
  logEbina.error("AuthManagerError:", err);
  return 500;
};

// deno-lint-ignore no-explicit-any
type AuthAction = (member: Member) => Promise<any>;
class AuthChallengeItem {
  challenge: string;
  createdAt: Date;
  action?: AuthAction;
  constructor(params: { challenge: string; action?: AuthAction }) {
    this.createdAt = new Date();
    this.challenge = params.challenge;
    this.action = params.action;
  }
}

class AuthChallenge {
  private static challenges: { [key: string]: AuthChallengeItem | undefined } =
    {};

  static set(key: string, challenge: string, action?: AuthAction) {
    this.challenges[key] = new AuthChallengeItem({ challenge, action });
  }

  static pop(key: string) {
    const item = this.challenges[key];
    if (!item) throw new AuthManagerError("No matching session id");
    delete this.challenges[key];
    return item;
  }
}

export class AuthManager {
  private static _instance: AuthManager;
  public static instance() {
    if (!this._instance) {
      this._instance = new AuthManager();
    }
    return this._instance;
  }
  private constructor() {
  }

  // Regist temp user

  getRegistNewMemeberToken(from: string) {
    const members = Members.instance();
    if (
      !Settings.instance().Member.canRegistNewMember(members.allMemberCount())
    ) return undefined;
    const token = randomBase64url(32);
    members.setPreRequest(token, from);
    return token;
  }

  registTempMemberOption(
    origin: string,
    token: string,
    id: string,
    name: string,
    password: string,
    deviceName = "FirstDevice",
  ) {
    const members = Members.instance();
    if (members.getMember(id)) throw new AuthManagerError("Already used id");
    const preRequest = members.popPreRequest(token);
    if (preRequest === null) throw new AuthManagerError("Expired");
    if (!preRequest) throw new AuthManagerError("No matching session id");
    const tempMember = members
      .registTempMember(preRequest.from, id, name, password);
    if (!tempMember) throw new AuthManagerError("Already used id");
    return createOptionsForRegist(origin, tempMember, deviceName);
  }

  async registTempMemberVerify(
    origin: string,
    id: string,
    response: AttestationResponseJSON,
  ) {
    const members = Members.instance();
    const tempMember = members.getTempMember(id);
    if (!tempMember) throw new AuthManagerError("No member");

    return await verifyChallengeForRegist(origin, tempMember.member, response)
      .then((newMember) => {
        members.setTempMember(tempMember.from, newMember);
        return newMember;
      });
  }

  // WebAuthn auth

  async createAuthOption(
    origin: string,
    key: string,
    option?: { id?: string; deviceNames?: string[]; action?: AuthAction },
  ) {
    let allowCredentials: PublicKeyCredentialDescriptor[] = [];
    if (option?.id) {
      const member = Members.instance().getMember(option.id);
      if (!member) throw new AuthManagerError("No member");

      const rpID = getRPID(origin);
      const webAuthnItem = member.getWebAuthnItem(rpID);
      if (!webAuthnItem) throw new AuthManagerError("No WebAuthn auth");
      allowCredentials = (option.deviceNames && option.deviceNames.length !== 0)
        ? webAuthnItem.getPublicKeyCredentials(option.deviceNames)
        : webAuthnItem.getEnabledPublicKeyCredentials();
    }
    const result = await createOptionsForAuth(origin, allowCredentials);
    AuthChallenge.set(key, result.challenge, option?.action);
    return result;
  }

  async verifyAuthResponse(
    origin: string,
    id: string,
    response: AuthenticationResponseJSON,
    sessionId?: string,
  ) {
    const member = Members.instance().getMember(id);
    if (!member) throw new AuthManagerError("No member");

    const challengeItem = AuthChallenge.pop(sessionId ?? id);

    await verifyChallengeForAuth(
      origin,
      member,
      response,
      challengeItem.challenge,
    );
    return challengeItem.action
      ? await challengeItem.action(member)
      : undefined;
  }

  // Login

  async loginWebAuthnOption(origin: string, id?: string) {
    const sessionId = randomBase64url(16);
    return await this.createAuthOption(origin, sessionId, {
      id,
      action: (member) => generateTokens(member.getId()),
    }).then((options) => ({ type: "WebAuthn", options, sessionId }));
  }

  checkDevicesOption(origin: string, id: string, deviceNames?: string[]) {
    return this.createAuthOption(origin, id, { id, deviceNames });
  }

  // Regist WebAuthn device

  registWebAuthnOption(
    origin: string,
    id: string,
    values: { deviceName: string; pass: string; code: string },
  ) {
    const member = Members.instance().getMember(id);
    if (!member) throw new AuthManagerError("No member");
    const verifyPass = member.authMemberWithPassword(values.pass);
    if (verifyPass === undefined) {
      throw new AuthManagerError("No password auth");
    }
    const verifyTOTP = member.verifyTOTP(values.code);
    if (verifyTOTP === undefined) throw new AuthManagerError("No TOTP auth");
    if (!verifyPass || !verifyTOTP) throw new AuthManagerError("Failed auth");
    return createOptionsForRegist(origin, member, values.deviceName);
  }

  async registWebAuthnVerify(
    origin: string,
    id: string,
    response: AttestationResponseJSON,
  ) {
    const members = Members.instance();
    const member = members.getMember(id);
    if (!member) throw new AuthManagerError("No member");

    return await verifyChallengeForRegist(origin, member, response)
      .then((newMember) => {
        members.setMember(newMember);
        return newMember;
      });
  }

  // Change password

  changePasswordOption(
    origin: string,
    id: string,
    current: string,
    to: string,
  ) {
    const members = Members.instance();
    const member = members.getMember(id);
    if (!member) throw new AuthManagerError("No member");
    const action = member.authMemberWithPassword(current)
      ? (member: Member) => {
        member.setPassword(createPasswordAuth(to));
        members.setMember(member);
        return Promise.resolve(true);
      }
      : undefined;
    return this.createAuthOption(origin, id, { id, action });
  }

  resetPasswordOption(
    origin: string,
    id: string,
    code: string,
    to: string,
  ) {
    const members = Members.instance();
    const member = members.getMember(id);
    if (!member) throw new AuthManagerError("No member");
    const action = member.verifyTOTP(code)
      ? (member: Member) => {
        member.setPassword(createPasswordAuth(to));
        members.setMember(member);
        return Promise.resolve(true);
      }
      : undefined;
    return this.createAuthOption(origin, id, { id, action });
  }

  changeTOTP(origin: string, id: string, pass: string, code: string) {
    const members = Members.instance();
    const member = members.getMember(id);
    if (!member) throw new AuthManagerError("No member");
    const hasWebAuthn = member.hasWebAuthn(new URL(origin).hostname);
    if (!hasWebAuthn) {
      const ret = member.registTempTOTP(code);
      members.setMember(member);
      return ret;
    }
    const action = member.authMemberWithPassword(pass)
      ? (member: Member) => {
        const ret = member.registTempTOTP(code);
        members.setMember(member);
        return Promise.resolve(ret);
      }
      : undefined;
    return this.createAuthOption(origin, id, { id, action });
  }
}
