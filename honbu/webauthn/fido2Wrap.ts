import { base64url, fido2 } from "../deps.ts";
import {
  AttestationConveyancePreference,
  AuthenticatorAttachment,
  PublicKeyCredentialDescriptor,
  PublicKeyCredentialType,
  ResidentKeyRequirement,
  UserVerificationRequirement,
} from "./types.ts";

export interface Fido2LibOptions {
  timeout?: number;
  challengeSize?: number;
  rpId?: string;
  rpName?: string;
  rpIcon?: string;
  authenticatorRequireResidentKey?: boolean;
  authenticatorAttachment?: AuthenticatorAttachment;
  authenticatorUserVerification?: UserVerificationRequirement;
  attestation?: AttestationConveyancePreference;
  cryptoParams?: number[];
}

// Attestation
export interface AttestationOptionUser {
  id: string;
  name: string;
  displayName?: string;
  icon?: string;
}

interface Fido2AttestationOptions {
  user: AttestationOptionUser;
  excludeCredentials?: PublicKeyCredentialDescriptor[];
  // deno-lint-ignore no-explicit-any
  extraData?: string | Array<any> | Uint8Array | ArrayBuffer;
  // deno-lint-ignore no-explicit-any
  extensionOptions?: string | Array<any> | Uint8Array | ArrayBuffer;
}

interface AttestationOptionsRet {
  rp: {
    name?: string;
    id?: string;
    icon?: string;
  };
  challenge: string;
  pubKeyCredParams: {
    alg: number;
    type: PublicKeyCredentialType;
  }[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: {
    authenticatorAttachment?: AuthenticatorAttachment;
    requireResidentKey?: boolean;
    residentKey?: ResidentKeyRequirement;
    userVerification?: UserVerificationRequirement;
  };
  rawChallenge: Uint8Array;
  extensions?: {
    appid?: string;
    appidExclude?: string;
    credProps?: boolean;
    uvm?: boolean;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  excludeCredentials?: PublicKeyCredentialDescriptor[];
}

interface AuthenticatorAttestationResponseJSON {
  clientDataJSON: string;
  attestationObject: string;
  transports: string[];
}

export interface AttestationResponseJSON {
  id: string;
  rawId: string;
  response: AuthenticatorAttestationResponseJSON;
  authenticatorAttachment?: string;
  clientExtensionResults: AuthenticationExtensionsClientOutputsJSON;
  type: string;
}

// Assertion
export interface Fido2AssertionOptions {
  allowCredentials?: PublicKeyCredentialDescriptor[];
  // deno-lint-ignore no-explicit-any
  extraData?: string | Array<any> | Uint8Array | ArrayBuffer;
  // deno-lint-ignore no-explicit-any
  extensionOptions?: string | Array<any> | Uint8Array | ArrayBuffer;
}

interface AssertionOptionsRet {
  challenge: string;
  timeout: number;
  rpId: string;
  userVerification: UserVerificationRequirement;
  rawChallenge: string;
  // deno-lint-ignore no-explicit-any
  extensions?: any;
}

interface AuthenticatorAssertionResponseJSON {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string;
}
// deno-lint-ignore no-empty-interface
interface AuthenticationExtensionsClientOutputsJSON {}

export interface AuthenticationResponseJSON {
  id: string;
  rawId: string;
  response: AuthenticatorAssertionResponseJSON;
  authenticatorAttachment?: string;
  clientExtensionResults: AuthenticationExtensionsClientOutputsJSON;
  type: string;
}

export class Fido2Wrap {
  fido2Lib: fido2.Fido2Lib;

  constructor(options?: Fido2LibOptions) {
    this.fido2Lib = new fido2.Fido2Lib(options);
  }

  async attestationOptions(options: Fido2AttestationOptions) {
    // deno-lint-ignore no-explicit-any
    const raw = await this.fido2Lib.attestationOptions(options) as any;
    const ret: AttestationOptionsRet = {
      ...raw,
      challenge: fido2.coerceToBase64(raw.challenge, "challenge"),
      user: {
        ...options.user,
        displayName: options.user.displayName ?? options.user.name,
      },
      excludeCredentials: options.excludeCredentials ?? [],
    };
    if (ret.authenticatorSelection) {
      if (ret.authenticatorSelection?.requireResidentKey) {
        ret.authenticatorSelection.residentKey = "required";
      } else {
        // 仕様ではあるっぽいけど入れるとダメらしい
        // ret.authenticatorSelection.residentKey = "discouraged"
      }
    }
    return ret;
  }

  async attestationResult(
    response: AttestationResponseJSON,
    expectations: {
      origin: string;
      challenge: string;
      factor: "first" | "second" | "either";
      flags?: [];
    },
  ) {
    return await this.fido2Lib.attestationResult({
      ...response,
      response: {
        ...response.response,
        attestationObject: fido2.coerceToArrayBuffer(
          response.response.attestationObject,
          "response.attestationObject",
        ),
      },
      rawId: fido2.coerceToArrayBuffer(response.rawId, "rawId"),
    }, expectations);
  }

  async assertionOptions(options: Fido2AssertionOptions) {
    // deno-lint-ignore no-explicit-any
    const raw = await this.fido2Lib.assertionOptions(options) as any;
    const ret: AssertionOptionsRet = {
      ...raw,
      challenge: fido2.coerceToBase64(raw.challenge, "challenge"),
      allowCredentials: options.allowCredentials,
    };
    if (raw.rawChallenge) {
      ret.rawChallenge = fido2.coerceToBase64(raw.rawChallenge, "rawChallenge");
    }
    return ret;
  }

  async assertionResult(
    response: AuthenticationResponseJSON,
    expectations: {
      origin: string;
      challenge: string;
      factor: "first" | "second" | "either";
      prevCounter: number;
      publicKey: string;
      userHandle?: string;
      allowCredentials?: PublicKeyCredentialDescriptor[];
    },
  ) {
    return await this.fido2Lib.assertionResult({
      ...response,
      response: {
        ...response.response,
        userHandle: response.response.userHandle
          ? fido2.abToBuf(response.response.userHandle)
          : undefined,
      },
      rawId: fido2.coerceToArrayBuffer(response.rawId, "rawId"),
    }, {
      ...expectations,
      userHandle: expectations.userHandle
        ? base64url.encode(expectations.userHandle)
        : undefined,

      // Level3暫定対応
      allowCredentials: expectations.allowCredentials?.map((it) => ({
        ...it,
        transports: it.transports?.filter((t) => t !== "hybrid") ?? [],
      })),
    });
  }
}
