import {
  AuthenticatorTransportFuture,
  PublicKeyCredentialType,
} from "../../../utils/webauthn/fido2Wrap.ts";

export type WebAuthnAuthenticator = {
  fmt: string;
  alg: { algName: string; hashAlg: string };
  counter: number; // necessary
  aaguid: string;
  credentialID: string; // necessary
  credentialPublicKey: string; // necessary
  credentialType: PublicKeyCredentialType;
  transports?: AuthenticatorTransportFuture[];
};

export type WebAuthnItem = {
  authenticators: { [name: string]: WebAuthnAuthenticator | undefined };
  enableDevices: string[];
};

export class WebAuthnItemController {
  private item: WebAuthnItem;

  constructor(webauthnItem?: WebAuthnItem) {
    this.item = webauthnItem ?? { authenticators: {}, enableDevices: [] };
  }

  getRawItem = () => this.item;

  hasAuthenticator = () => Object.values(this.item.authenticators).length !== 0;

  getAuthenticator = (name: string) => this.item.authenticators[name];

  getAuthenticatorFromIndex(index: number) {
    const deviceNames = Object.keys(this.item.authenticators);
    if (index >= deviceNames.length) return undefined;
    const deviceName = deviceNames[index];
    return { deviceName, authenticator: this.getAuthenticator(deviceName) };
  }

  getAuthenticatorNames = () => Object.keys(this.item.authenticators);

  getAuthenticatorFromCertId(id: string) {
    const deviceName = this.getAuthenticatorNames().find((deviceName) => {
      const authenticator = this.getAuthenticator(deviceName);
      if (!authenticator) return false;
      return authenticator.credentialID === id;
    });
    if (!deviceName) return undefined;
    return { deviceName, authenticator: this.getAuthenticator(deviceName)! };
  }

  setAuthenticator(name: string, authenticator: WebAuthnAuthenticator) {
    const overwrite = this.getAuthenticator(name) !== undefined;
    this.item.authenticators[name] = authenticator;
    return overwrite;
  }

  addAuthenticator(name: string, authenticator: WebAuthnAuthenticator) {
    this.item.enableDevices.push(name);
    return this.setAuthenticator(name, authenticator);
  }

  deleteAuthenticator(name: string) {
    if (!this.getAuthenticator(name)) return false;
    this.deleteEnableDeviceName(name);
    delete this.item.authenticators[name];
    return true;
  }

  getRawEnableDeviceNames = () => this.item.enableDevices;

  getEnableDeviceNames() {
    const enableDeviceNames = this.getRawEnableDeviceNames();
    if (enableDeviceNames.length !== 0) {
      return enableDeviceNames;
    } else {
      const firstAuthenticator = this.getAuthenticatorFromIndex(0);
      if (!firstAuthenticator) throw new Error("No Authenticators");
      return [firstAuthenticator.deviceName];
    }
  }

  addEnableDeviceName = (name: string) => this.item.enableDevices.push(name);

  hasEnableDeviceName = (name: string) =>
    this.item.enableDevices.includes(name);

  deleteEnableDeviceName = (name: string) =>
    this.item.enableDevices = this.item.enableDevices
      .filter((it) => it !== name);

  getPublicKeyCredentials(names?: string[]) {
    const targetAuthenticators =
      (names
        ? names.map((name) => (this.item.authenticators[name]))
        : Object.values(this.item.authenticators))
        .filter((v) => v) as WebAuthnAuthenticator[];

    return targetAuthenticators
      .map((authenticator) => ({
        id: authenticator.credentialID,
        type: authenticator.credentialType,
        transports: authenticator.transports,
      }));
  }
}

export type WebAuthn = {
  [hostname: string]: WebAuthnItem | undefined;
};

export const hasHostname = (webAuthn: WebAuthn, hostname: string) => {
  return webAuthn[hostname] !== undefined;
};
