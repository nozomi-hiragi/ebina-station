export type AuthenticatorTransportFuture =
  | "ble"
  | "internal"
  | "nfc"
  | "usb"
  | "cable"
  | "hybrid";

export type PublicKeyCredentialType = "public-key";

type AuthenticatorAttachment = "cross-platform" | "platform";

type ResidentKeyRequirement =
  | "discouraged"
  | "preferred"
  | "required";

type UserVerificationRequirement =
  | "discouraged"
  | "preferred"
  | "required";

interface AuthenticatorSelectionCriteria {
  authenticatorAttachment?: AuthenticatorAttachment;
  requireResidentKey?: boolean;
  residentKey?: ResidentKeyRequirement;
  userVerification?: UserVerificationRequirement;
}

interface PublicKeyCredentialDescriptor {
  id: BufferSource;
  transports?: AuthenticatorTransportFuture[];
  type: PublicKeyCredentialType;
}

interface PublicKeyCredentialDescriptorJSON
  extends Omit<PublicKeyCredentialDescriptor, "id"> {
  id: string;
}

interface AuthenticationExtensionsClientInputs {
  appid?: string;
  appidExclude?: string;
  credProps?: boolean;
  uvm?: boolean;
}

interface PublicKeyCredentialParameters {
  alg: number;
  type: PublicKeyCredentialType;
}

export type AttestationConveyancePreference =
  | "direct"
  | "enterprise"
  | "indirect"
  | "none";

interface PublicKeyCredentialRpEntity {
  name: string;
  id?: string;
}

interface PublicKeyCredentialUserEntity {
  name: string;
  displayName: string;
  id: BufferSource;
}

interface PublicKeyCredentialUserEntityJSON
  extends Omit<PublicKeyCredentialUserEntity, "id"> {
  id: string;
}

export interface PublicKeyCredentialCreationOptions {
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  challenge: ArrayBuffer;
  excludeCredentials?: PublicKeyCredentialDescriptor[];
  extensions?: AuthenticationExtensionsClientInputs;
  pubKeyCredParams: PublicKeyCredentialParameters[];
  rp: PublicKeyCredentialRpEntity;
  timeout?: number;
  user: PublicKeyCredentialUserEntity;
}

export interface PublicKeyCredentialCreationOptionsJSON extends
  Omit<
    PublicKeyCredentialCreationOptions,
    "challenge" | "user" | "excludeCredentials"
  > {
  user: PublicKeyCredentialUserEntityJSON;
  challenge: string;
  excludeCredentials: PublicKeyCredentialDescriptorJSON[];
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface PublicKeyCredentialRequestOptionsJSON
  extends
    Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> {
  challenge: string;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
}

export interface PublicKeyCredentialRequestOptions {
  allowCredentials?: PublicKeyCredentialDescriptor[];
  challenge: Uint8Array;
  extensions?: AuthenticationExtensionsClientInputs;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
}

export interface AssertionExpectations {
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  challenge: string;
  origin: string;
  factor: string;
  publicKey: string;
  prevCounter: number;
  userHandle: string;

  rpId?: string;
  flags?: string;
}
