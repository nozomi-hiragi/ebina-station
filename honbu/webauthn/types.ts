export type Requirement = "discouraged" | "preferred" | "required";
export type ResidentKeyRequirement = Requirement;
export type UserVerificationRequirement = Requirement;
export type AuthenticatorAttachment = "cross-platform" | "platform";
export type AttestationConveyancePreference = "direct" | "indirect" | "none";
export type PublicKeyCredentialType = "public-key";
export type AuthenticatorTransportFuture =
  | "ble"
  | "internal"
  | "nfc"
  | "usb"
  | "cable"
  | "hybrid";

export interface PublicKeyCredentialDescriptor {
  id: string;
  transports?: AuthenticatorTransportFuture[];
  type: PublicKeyCredentialType;
}
