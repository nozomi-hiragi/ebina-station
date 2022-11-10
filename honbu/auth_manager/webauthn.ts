import { base64 } from "../deps.ts";
import { PasswordAuth } from "../project_data/members/auth/password.ts";
import { WebAuthnItemController } from "../project_data/members/auth/webauthn.ts";
import { Member } from "../project_data/members/member.ts";
import { Members } from "../project_data/members/mod.ts";
import { Settings } from "../project_data/settings/mod.ts";
import {
  AttestationOptionUser,
  AttestationResponseJSON,
  AuthenticationResponseJSON,
  Fido2LibOptions,
  Fido2Wrap,
} from "../webauthn/fido2Wrap.ts";
import { PublicKeyCredentialDescriptor } from "../webauthn/types.ts";
import { AuthManagerError } from "./mod.ts";

export type ChallengeAction = PasswordAuth;

// @TODO  メンバー書き換えの方法見直したほうがいい

const f2lList: { [id: string]: Fido2Wrap | undefined } = {};

export const getRPID = (origin: string) => {
  const { hostname } = new URL(origin);
  const rpID = Settings.instance().WebAuthn.getWebAuthnRPID(hostname);
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
  const settings = Settings.instance();
  const webAuthnSetting = settings.WebAuthn;
  if (!webAuthnSetting) throw "No WebAuthn setting";

  return f2lList[rpId] ??
    (f2lList[rpId] = createF2L({
      rpId,
      rpName: webAuthnSetting.getRpName(),
      attestation: webAuthnSetting.getAttestationType(),
    }));
};

export const createOptionsForRegist = async (
  origin: string,
  member: Member,
  deviceName: string,
) => {
  const rpID = getRPID(origin);

  const user: AttestationOptionUser = {
    id: member.getId(),
    name: member.getName(),
    displayName: member.getName(),
  };

  const excludeCredentials = member
    .getWebAuthnItem(rpID)?.getPublicKeyCredentials();

  const options = await getF2L(rpID)
    .attestationOptions({ user, excludeCredentials });
  member.setChallengeWebAuthn(deviceName, options.challenge);
  return options;
};

export const verifyChallengeForRegist = async (
  origin: string,
  member: Member,
  response: AttestationResponseJSON,
) => {
  const challengeItem = member.getChallengeWebAuthn();
  if (!challengeItem) throw new AuthManagerError("No matching session id");

  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID) ??
    new WebAuthnItemController();
  if (webAuthnItem.getAuthenticator(challengeItem.name)) {
    throw new AuthManagerError("Already used device name");
  }

  try {
    const result = await getF2L(rpID).attestationResult(response, {
      challenge: challengeItem.challenge,
      origin,
      factor: "either",
    });

    webAuthnItem.addAuthenticator(challengeItem.name, {
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
  } catch (err) {
    console.log(err);
    throw new AuthManagerError("Failed auth");
  }
};

export const createOptionsForAuth = (
  origin: string,
  allowCredentials?: PublicKeyCredentialDescriptor[],
) => {
  const rpID = getRPID(origin);
  return getF2L(rpID).assertionOptions({ allowCredentials });
};

export const verifyChallengeForAuth = async (
  origin: string,
  member: Member,
  response: AuthenticationResponseJSON,
  challenge: string,
) => {
  const rpID = getRPID(origin);
  const webAuthnItem = member.getWebAuthnItem(rpID);
  if (!webAuthnItem) throw new AuthManagerError("Wrong rpId");

  const authenticatorSet = webAuthnItem
    .getAuthenticatorFromCertId(response.id);
  if (!authenticatorSet) throw new AuthManagerError("No matching session id"); //
  const { deviceName, authenticator } = authenticatorSet;
  const allowCredentials = webAuthnItem.getEnabledPublicKeyCredentials();

  try {
    const result = await getF2L(rpID).assertionResult(response, {
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
    Members.instance().setMember(member);
    return result;
  } catch (err) {
    console.log(err);
    throw new AuthManagerError("Failed auth");
  }
};
