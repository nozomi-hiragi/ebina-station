import { createPasswordAuth } from "../project_data/members/auth/password.ts";
import { Member } from "../project_data/members/member.ts";
import { Members } from "../project_data/members/mod.ts";
import { Settings } from "../project_data/settings/mod.ts";
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

export type AuthManagerErrorType =
  | "No member"
  | "Failed auth"
  | "No password auth"
  | "No WebAuthn auth"
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

export const hadleAMErrorToStatus = (err: Error) => {
  if (err instanceof AuthManagerError) {
    const ret = convertAMErrorToStatus(err);
    if (ret.status !== 500) {
      return ret.status;
    }
  }
  console.log(err);
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

  // Login

  loginWithPassword(hostname: string, id: string, password: string) {
    const member = Members.instance().getMember(id);
    if (!member) throw new AuthManagerError("No member");

    if (member.hasWebAuthn(hostname)) {
      throw new AuthManagerError("WebAuthn Enabled");
    }

    switch (member.authMemberWithPassword(password)) {
      case true:
        return generateTokens(member.getId());
      case false:
        throw new AuthManagerError("Failed auth");
      case undefined:
        throw new AuthManagerError("No password auth");
    }
  }

  async loginWebAuthnOption(origin: string, id?: string) {
    const members = Members.instance();

    let allowCredentials;
    if (id) {
      const member = members.getMember(id);
      if (member) {
        const rpID = getRPID(origin);
        const webAuthnItem = member.getWebAuthnItem(rpID);
        if (!webAuthnItem) return { type: "Password" };
        allowCredentials = webAuthnItem.getEnabledPublicKeyCredentials();
      } else {
        throw new AuthManagerError("No member");
      }
    }

    const options = await createOptionsForAuth(origin, allowCredentials);
    const sessionId = randomBase64url(16);
    AuthChallenge.set(
      sessionId,
      options.challenge,
      (member) => generateTokens(member.getId()),
    );
    return { type: "WebAuthn", options, sessionId };
  }

  async checkDevicesOption(origin: string, id: string, deviceNames?: string[]) {
    const member = Members.instance().getMember(id);
    if (!member) throw new AuthManagerError("No member");

    const rpID = getRPID(origin);
    const webAuthnItem = member.getWebAuthnItem(rpID);
    if (!webAuthnItem) throw new AuthManagerError("No WebAuthn auth");

    const allowCredentials = deviceNames && deviceNames.length !== 0
      ? webAuthnItem.getPublicKeyCredentials(deviceNames)
      : webAuthnItem.getEnabledPublicKeyCredentials();

    const options = await createOptionsForAuth(origin, allowCredentials);
    AuthChallenge.set(id, options.challenge);

    return options;
  }

  // Regist WebAuthn device

  registWebAuthnOption(origin: string, id: string, deviceName: string) {
    const member = Members.instance().getMember(id);
    if (!member) throw new AuthManagerError("No member");
    return createOptionsForRegist(origin, member, deviceName);
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

  async changePasswordOption(
    origin: string,
    id: string,
    current: string,
    to: string,
  ) {
    const members = Members.instance();
    const member = members.getMember(id);
    if (!member) throw new AuthManagerError("No member");
    const rpID = getRPID(origin);
    const webAuthnItem = member.getWebAuthnItem(rpID);
    if (!webAuthnItem) throw new AuthManagerError("No WebAuthn auth");
    const allowCredentials = webAuthnItem.getEnabledPublicKeyCredentials();

    const options = await createOptionsForAuth(origin, allowCredentials);
    const action = member.authMemberWithPassword(current)
      ? (member: Member) => {
        member.setPassword(createPasswordAuth(to));
        members.setMember(member);
        return Promise.resolve(true);
      }
      : undefined;
    AuthChallenge.set(id, options.challenge, action);
    return options;
  }

  // Verify WebAuthn response

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
}
