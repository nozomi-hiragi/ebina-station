import { base64, Fido2Lib } from "../../deps.ts";
import { Member } from "../../settings/members/member.ts";
import { getMembers, WebAuthnItem } from "../../settings/members/members.ts";
import { getSettings } from "../../settings/settings.ts";
import { HttpExeption } from "../utils.ts";
import {
  AssertionExpectations,
  AttestationConveyancePreference,
  PublicKeyCredentialCreationOptions,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptions,
  PublicKeyCredentialRequestOptionsJSON,
  WebAuthnAuthenticator,
} from "./types.ts";

const challenges: { [key: string]: string | undefined } = {};

const f2lList: { [id: string]: Fido2Lib | undefined } = {};

const createF2L = (
  rpId: string,
  rpName: string,
  attestation?: AttestationConveyancePreference,
) =>
  new Fido2Lib({
    rpId,
    rpName,
    challengeSize: 128,
    attestation,
    cryptoParams: [-7, -36, -37, -38, -39, -257, -258, -259],
    authenticatorRequireResidentKey: false,
    authenticatorUserVerification: "preferred",
  });

const getF2L = (hostname: string) => {
  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) throw "No WebAuthn setting";

  const rpId = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpId) throw "No rpID value";

  let f2l = f2lList[rpId];
  if (f2l) return f2l;

  f2l = createF2L(
    rpId,
    webAuthnSetting.rpName,
    webAuthnSetting.attestationType,
  );

  f2lList[rpId] = f2l;
  return f2l;
};

export const createRegistOptions = async (
  origin: string,
  member: Member,
  fource = false,
) => {
  const { hostname } = new URL(origin);

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) throw new HttpExeption(500, "No WebAuthn setting");

  const rpID = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpID) throw new HttpExeption(500, "No rpID value");

  const webAuthnItem: WebAuthnItem = member.getWebAuthnItem(rpID) ??
    { authenticators: {}, enableDevices: [] };
  const f2l = getF2L(hostname);
  const options = await f2l
    .attestationOptions() as PublicKeyCredentialCreationOptions;
  const optionsJson: PublicKeyCredentialCreationOptionsJSON = {
    ...options,
    user: {
      id: member.getId(),
      name: member.getName(),
      displayName: member.getName(),
    },
    challenge: base64.encode(options.challenge),
    excludeCredentials: Object.values(webAuthnItem.authenticators)
      .filter((authenticator) => authenticator !== undefined && !fource)
      .map((authenticator) => ({
        type: authenticator!.credentialType,
        id: authenticator!.credentialID,
        transports: authenticator!.transports,
      })),
  };
  challenges[member.getId()] = optionsJson.challenge;

  return optionsJson;
};

export const verifyRegistChallenge = async (
  origin: string,
  member: Member,
  deviceName: string,
  // deno-lint-ignore no-explicit-any
  body: any,
) => {
  const { hostname } = new URL(origin);

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    throw new HttpExeption(500, "No WebAuthn setting");
  }

  const rpID = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpID) {
    throw new HttpExeption(500, "No rpID value");
  }

  const webAuthnItem: WebAuthnItem = member.getWebAuthnItem(rpID) ??
    { authenticators: {}, enableDevices: [] };
  if (webAuthnItem.authenticators[deviceName]) {
    throw new HttpExeption(400, "Already used this device name");
  }

  const f2l = getF2L(hostname);

  body.response.attestationObject = base64.decode(
    body.response.attestationObject,
  ).buffer;
  body.rawId = base64.decode(body.rawId).buffer;

  const challenge = challenges[member.getId()];
  if (!challenge) {
    throw new HttpExeption(409, "didn't challenge");
  }
  delete challenges[member.getId()];

  const attestationExpectations = {
    challenge,
    origin,
    factor: "either",
  };
  const result = await f2l.attestationResult(body, attestationExpectations);

  webAuthnItem.authenticators[deviceName] = {
    fmt: result.authnrData!.get("fmt"),
    alg: result.authnrData!.get("alg"),
    counter: result.authnrData!.get("counter"),
    aaguid: base64.encode(result.authnrData!.get("aaguid")),
    credentialID: base64.encode(result.authnrData!.get("credId")),
    credentialPublicKey: result.authnrData!.get("credentialPublicKeyPem"),
    transports: result.authnrData!.get("transports"),
    credentialType: "public-key",
  };
  webAuthnItem.enableDevices.push(deviceName);
  member.setWebAuthnItem(rpID, webAuthnItem);
  getMembers().setMember(member);
};

export const createLoginOptions = async (
  origin: string,
  member: Member,
  deviceNames: string[],
) => {
  const { hostname } = new URL(origin);

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    throw new HttpExeption(500, "No WebAuthn setting");
  }

  const rpID = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpID) {
    throw new HttpExeption(500, "No rpID value");
  }

  const webAuthnItem = member.getWebAuthnItem(rpID);
  if (!webAuthnItem) {
    throw new HttpExeption(406, "no webauthn authenticator");
  }

  const targetDeviceNames = deviceNames.length ? deviceNames : (
    webAuthnItem.enableDevices.length
      ? webAuthnItem.enableDevices
      : [Object.keys(webAuthnItem.authenticators)[0]]
  );

  const authenticators = targetDeviceNames
    .map((deviceName) => webAuthnItem.authenticators[deviceName])
    .filter((a) => a) as WebAuthnAuthenticator[];

  const f2l = getF2L(hostname);
  const option = await f2l
    .assertionOptions() as PublicKeyCredentialRequestOptions;
  const optionsJson: PublicKeyCredentialRequestOptionsJSON = {
    challenge: base64.encode(option.challenge),
    extensions: option.extensions,
    rpId: option.rpId,
    timeout: option.timeout,
    userVerification: option.userVerification,
    allowCredentials: authenticators.map((authenticator) => ({
      id: authenticator.credentialID,
      type: authenticator.credentialType,
      transports: authenticator.transports,
    })),
  };
  challenges[member.getId()] = optionsJson.challenge;
  return optionsJson;
};

export const verifyLoginChallenge = async (
  origin: string,
  member: Member,
  // deno-lint-ignore no-explicit-any
  body: any,
) => {
  const { hostname } = new URL(origin);

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    throw new HttpExeption(500, "No WebAuthn setting");
  }

  const rpID = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpID) {
    throw new HttpExeption(500, "No rpID value");
  }

  const webAuthnItem = member.getWebAuthnItem(rpID);
  if (!webAuthnItem) {
    throw new HttpExeption(400, "wrong rpid");
  }

  const deviceName = Object.keys(webAuthnItem.authenticators)
    .find((deviceName) => {
      const authenticator = webAuthnItem.authenticators[deviceName];
      if (!authenticator) return false;
      return authenticator.credentialID === body.id;
    });
  if (!deviceName) {
    throw new HttpExeption(404, "Can't find device from this credential id");
  }

  body.rawId = base64.decode(body.rawId).buffer;
  body.response.userHandle = body.rawId;
  const f2l = getF2L(hostname);
  const authenticator = webAuthnItem.authenticators[deviceName]!;

  const challenge = challenges[member.getId()];
  if (!challenge) {
    throw new HttpExeption(409, "didn't challenge");
  }
  delete challenges[member.getId()];

  const assertionExpectations: AssertionExpectations = {
    challenge,
    origin,
    factor: "either",
    publicKey: authenticator.credentialPublicKey,
    prevCounter: authenticator.counter,
    userHandle: authenticator.credentialID,
  };
  const result = await f2l.assertionResult(body, assertionExpectations);

  webAuthnItem.authenticators[deviceName]!.counter = result.authnrData
    ?.get("counter");
  member.setWebAuthnItem(rpID, webAuthnItem);
  getMembers().setMember(member);
};

export const getAuthenticatorNames = (origin: string, member: Member) => {
  const { hostname } = new URL(origin);

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    throw new HttpExeption(500, "No WebAuthn setting");
  }

  const rpID = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpID) {
    throw new HttpExeption(500, "No rpID value");
  }

  const webAuthnItem = member.getWebAuthnItem(rpID);
  const authenticatorNames = webAuthnItem
    ? Object.keys(webAuthnItem.authenticators)
    : [];

  return authenticatorNames;
};

export const deleteAuthenticators = (
  origin: string,
  member: Member,
  deviceNames: string[],
) => {
  const { hostname } = new URL(origin);

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    throw new HttpExeption(500, "No WebAuthn setting");
  }

  const rpID = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpID) {
    throw new HttpExeption(500, "No rpID value");
  }

  const webAuthnItem = member.getWebAuthnItem(rpID);
  const authenticatorNames = Object.keys(webAuthnItem?.authenticators ?? {});
  if (!webAuthnItem || authenticatorNames.length === 0) {
    throw new HttpExeption(404, "Disable WebAuthn on this account");
  }

  const failedNames: string[] = [];
  authenticatorNames.forEach((name) => {
    const isTarget = deviceNames ? deviceNames.includes(name) : true;
    if (!isTarget) return;
    if (webAuthnItem.authenticators[name]) {
      delete webAuthnItem.authenticators[name];
      webAuthnItem.enableDevices = webAuthnItem.enableDevices
        .filter((it) => it !== name);
    } else {
      failedNames.push(name);
    }
  });

  console.log("delete", webAuthnItem);
  member.setWebAuthnItem(rpID, webAuthnItem);
  getMembers().setMember(member);

  return failedNames;
};

export const getEnableAuthenticators = (origin: string, member: Member) => {
  const { hostname } = new URL(origin);

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    throw new HttpExeption(500, "No WebAuthn setting");
  }

  const rpID = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpID) {
    throw new HttpExeption(500, "No rpID value");
  }

  const webAuthnItem = member.getWebAuthnItem(rpID);
  const authenticatorNames = Object.keys(webAuthnItem?.authenticators ?? {});
  if (!webAuthnItem || authenticatorNames.length === 0) {
    throw new HttpExeption(404, "Disable WebAuthn on this account");
  }

  return webAuthnItem.enableDevices;
};

export const enableAuthenticator = (
  origin: string,
  member: Member,
  deviceName: string,
) => {
  const { hostname } = new URL(origin);

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    throw new HttpExeption(500, "No WebAuthn setting");
  }

  const rpID = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpID) {
    throw new HttpExeption(500, "No rpID value");
  }

  const webAuthnItem = member.getWebAuthnItem(rpID);
  const authenticatorNames = Object.keys(webAuthnItem?.authenticators ?? {});
  if (!webAuthnItem || authenticatorNames.length === 0) {
    throw new HttpExeption(404, "Disable WebAuthn on this account");
  }

  if (!Object.keys(webAuthnItem.authenticators).includes(deviceName)) {
    throw new HttpExeption(404, "not found this device");
  }
  if (webAuthnItem.enableDevices.includes(deviceName)) {
    return false;
  } else {
    webAuthnItem.enableDevices.push(deviceName);
    member.setWebAuthnItem(rpID, webAuthnItem);
    getMembers().setMember(member);
    return true;
  }
};

export const disableAuthenticator = (
  origin: string,
  member: Member,
  deviceName: string,
) => {
  const { hostname } = new URL(origin);

  const settings = getSettings();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) {
    throw new HttpExeption(500, "No WebAuthn setting");
  }

  const rpID = settings.isRPIDStatic() ? webAuthnSetting.rpID : hostname;
  if (!rpID) {
    throw new HttpExeption(500, "No rpID value");
  }

  const webAuthnItem = member.getWebAuthnItem(rpID);
  const authenticatorNames = Object.keys(webAuthnItem?.authenticators ?? {});
  if (!webAuthnItem || authenticatorNames.length === 0) {
    throw new HttpExeption(404, "Disable WebAuthn on this account");
  }

  if (!Object.keys(webAuthnItem.authenticators).includes(deviceName)) {
    throw new HttpExeption(404, "not found this device");
  }
  const include = webAuthnItem.enableDevices.includes(deviceName);

  if (!include) {
    return false;
  } else {
    webAuthnItem.enableDevices = webAuthnItem.enableDevices
      .filter((enable) => enable !== deviceName);
    member.setWebAuthnItem(rpID, webAuthnItem);
    getMembers().setMember(member);
    return true;
  }
};
