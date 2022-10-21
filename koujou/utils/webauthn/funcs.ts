import { base64 } from "../../deps.ts";
import { PasswordAuth } from "../../settings/members/auth/password.ts";
import { WebAuthnItemController } from "../../settings/members/auth/webauthn.ts";
import { Member } from "../../settings/members/member.ts";
import { getMembers } from "../../settings/members/members.ts";
import { getSettings } from "../../settings/settings.ts";
import { HttpExeption } from "../utils.ts";
import {
  AttestationOptionUser,
  AttestationResponseJSON,
  AuthenticationResponseJSON,
  Fido2AssertionOptions,
  Fido2LibOptions,
  Fido2Wrap,
} from "./fido2Wrap.ts";

export type ChallengeAction = PasswordAuth;

// @TODO  メンバー書き換えの方法見直したほうがいい

// deno-lint-ignore no-explicit-any
type AuthAction = (member: Member) => Promise<any>;

class ChallengeItem {
  challenge: string;
  createdAt: Date;
  action?: AuthAction;
  constructor(params: { challenge: string; action?: AuthAction }) {
    this.createdAt = new Date();
    this.challenge = params.challenge;
    this.action = params.action;
  }
}

const challenges: { [key: string]: ChallengeItem | undefined } = {};

const f2lList: { [id: string]: Fido2Wrap | undefined } = {};

export const getRPID = (origin: string) => {
  const rpID = getSettings().getWebAuthnRPID(origin);
  if (!rpID) throw new HttpExeption(500, "No rpID value");
  return rpID;
};

const createF2L = (options: Fido2LibOptions) =>
  new Fido2Wrap({
    challengeSize: 128,
    cryptoParams: [-7, -35, -36, -37, -38, -39, -257, -258, -259],
    authenticatorRequireResidentKey: false,
    authenticatorUserVerification: "required",
    ...options,
  });

const getF2L = (rpId: string) => {
  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) throw "No WebAuthn setting";
  const { rpName, attestationType } = webAuthnSetting;

  return f2lList[rpId] ??
    (f2lList[rpId] = createF2L({ rpId, rpName, attestation: attestationType }));
};

export const createOptionsForRegist = async (
  origin: string,
  member: Member,
  fource = false,
) => {
  const rpID = getRPID(origin);

  const user: AttestationOptionUser = {
    id: member.getId(),
    name: member.getName(),
    displayName: member.getName(),
  };

  const webAuthnItem = member.getWebAuthnItem(rpID) ??
    new WebAuthnItemController();
  const excludeCredentials = fource
    ? []
    : webAuthnItem.getPublicKeyCredentials();

  const options = await getF2L(rpID)
    .attestationOptions({ user, excludeCredentials });
  const { challenge } = options;
  challenges[member.getId()] = new ChallengeItem({ challenge });

  return options;
};

export const verifyChallengeForRegist = async (
  origin: string,
  member: Member,
  deviceName: string,
  body: AttestationResponseJSON,
) => {
  const rpID = getRPID(origin);

  const webAuthnItem = member.getWebAuthnItem(rpID) ??
    new WebAuthnItemController();
  if (webAuthnItem.getAuthenticator(deviceName)) {
    throw new HttpExeption(400, "Already used this device name");
  }

  const challenge = challenges[member.getId()];
  if (!challenge) throw new HttpExeption(409, "didn't challenge");
  delete challenges[member.getId()];

  const result = await getF2L(rpID).attestationResult(body, {
    challenge: challenge.challenge,
    origin,
    factor: "either",
  });

  webAuthnItem.addAuthenticator(deviceName, {
    fmt: result.authnrData!.get("fmt"),
    alg: result.authnrData!.get("alg"),
    counter: result.authnrData!.get("counter"),
    aaguid: base64.encode(result.authnrData!.get("aaguid")),
    credentialID: base64.encode(result.authnrData!.get("credId")),
    credentialPublicKey: result.authnrData!.get("credentialPublicKeyPem"),
    transports: result.authnrData!.get("transports"),
    credentialType: "public-key",
  });
  member.setWebAuthnItem(rpID, webAuthnItem);

  return member;
};

export const createOptionsForAuth = async (
  origin: string,
  challengeId: string,
  action?: AuthAction,
  member?: Member,
  deviceNames?: string[],
) => {
  const rpID = getRPID(origin);
  const options: Fido2AssertionOptions = {};

  if (member) {
    const webAuthnItem = member.getWebAuthnItem(rpID);
    if (!webAuthnItem) throw new HttpExeption(406, "no webauthn authenticator");

    const targetDeviceNames = deviceNames && deviceNames.length !== 0
      ? deviceNames
      : webAuthnItem.getEnableDeviceNames();

    options.allowCredentials = webAuthnItem.getPublicKeyCredentials(
      targetDeviceNames,
    );
  }

  const ret = await getF2L(rpID).assertionOptions(options);
  const { challenge } = ret;
  challenges[challengeId] = new ChallengeItem({ challenge, action });
  return ret;
};

export const verifyChallengeForAuth = async (
  origin: string,
  member: Member,
  body: AuthenticationResponseJSON,
  challengeId: string,
) => {
  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  if (!webAuthnItem) throw new HttpExeption(400, "wrong rpid");

  const authenticatorSet = webAuthnItem.getAuthenticatorFromCertId(body.id);
  if (!authenticatorSet) {
    throw new HttpExeption(404, "Can't find device from this credential id");
  }
  const { deviceName, authenticator } = authenticatorSet;
  const allowCredentials = webAuthnItem
    .getPublicKeyCredentials(webAuthnItem.getEnableDeviceNames());

  const challengeItem = challenges[challengeId];
  if (!challengeItem) throw new HttpExeption(409, "invalid challenge");
  delete challenges[challengeId];
  const { challenge } = challengeItem;

  const result = await getF2L(rpID).assertionResult(body, {
    challenge,
    origin,
    factor: "either",
    publicKey: authenticator.credentialPublicKey,
    prevCounter: authenticator.counter,
    userHandle: member.getId(),
    allowCredentials,
  });

  authenticator.counter = result.authnrData!.get("counter");
  webAuthnItem.setAuthenticator(deviceName, authenticator);
  member.setWebAuthnItem(rpID, webAuthnItem);

  getMembers().setMember(member);

  return {
    result,
    actionResult: challengeItem.action && await challengeItem.action(member),
  };
};

export const deleteAuthenticators = (
  origin: string,
  member: Member,
  deviceNames?: string[],
) => {
  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  const authenticatorNames = webAuthnItem?.getAuthenticatorNames() ?? [];
  if (!webAuthnItem || authenticatorNames.length === 0) {
    throw new HttpExeption(404, "Disable WebAuthn on this account");
  }

  const failedNames: string[] = [];
  authenticatorNames.forEach((name) => {
    const isTarget = deviceNames?.includes(name) ?? true;
    if (!isTarget) return;
    if (webAuthnItem.getAuthenticator(name)) {
      webAuthnItem.deleteAuthenticator(name);
    } else {
      failedNames.push(name);
    }
  });
  member.setWebAuthnItem(rpID, webAuthnItem);
  getMembers().setMember(member);

  return failedNames;
};

export const getRawEnableAuthenticators = (origin: string, member: Member) => {
  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  const authenticatorNames = webAuthnItem?.getAuthenticatorNames() ?? [];

  if (!webAuthnItem || authenticatorNames.length === 0) {
    throw new HttpExeption(404, "Disable WebAuthn on this account");
  }

  return webAuthnItem.getRawEnableDeviceNames();
};

export const switchEnableAuthenticator = (
  origin: string,
  member: Member,
  deviceName: string,
  toEnable: boolean,
) => {
  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  const authenticatorNames = webAuthnItem?.getAuthenticatorNames() ?? [];
  if (!webAuthnItem || authenticatorNames.length === 0) {
    throw new HttpExeption(404, "Disable WebAuthn on this account");
  }

  if (!authenticatorNames.includes(deviceName)) {
    throw new HttpExeption(404, "not found this device");
  }

  if (webAuthnItem.hasEnableDeviceName(deviceName) === toEnable) {
    return false;
  } else {
    if (toEnable) webAuthnItem.addEnableDeviceName(deviceName);
    else webAuthnItem.deleteEnableDeviceName(deviceName);
    member.setWebAuthnItem(rpID, webAuthnItem);
    getMembers().setMember(member);
    return true;
  }
};
