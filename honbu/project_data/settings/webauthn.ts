import { AttestationConveyancePreference } from "../../utils/webauthn/fido2Wrap.ts";

export interface SettingWebAuthnValues {
  rpName: string;
  rpIDType: "variable" | "static";
  rpID?: string;
  attestationType?: AttestationConveyancePreference;
}

const DEFAULT_SETTINGS_VALUE_WEBAUTHN: SettingWebAuthnValues = {
  rpName: "EbinaStation",
  rpIDType: "variable",
};

export class WebAuthnSettings {
  values: SettingWebAuthnValues;

  constructor(values: SettingWebAuthnValues = DEFAULT_SETTINGS_VALUE_WEBAUTHN) {
    this.values = values;
  }
  getRawValue = () => this.values;

  setRpName(rpName: string) {
    this.values.rpName = rpName;
  }
  getRpName = () => this.values.rpName;

  setRpIDType(rpIDType: "variable" | "static") {
    this.values.rpIDType = rpIDType;
  }
  getRpIDType = () => this.values.rpIDType;

  setRpID(rpID?: string) {
    this.values.rpID = rpID;
  }
  getRpID = () => this.values.rpID;

  setAttestationType(attestationType: AttestationConveyancePreference) {
    this.values.attestationType = attestationType;
  }
  getAttestationType = () => this.values.attestationType;

  isRPIDStatic() {
    switch (this.values.rpIDType) {
      case "variable":
        return false;
      default:
      case "static":
        return true;
    }
  }

  getWebAuthnRPID(origin: string) {
    const rpID = this.isRPIDStatic()
      ? this.getRpID()
      : new URL(origin).hostname;
    return rpID;
  }
}
