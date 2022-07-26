import { PROJECT_PATH } from "../ebinaAPI/app/index.ts";
import { AttestationConveyancePreference } from "../utils/webauthn.ts";

const SETTINGS_FILE_PATH = `${PROJECT_PATH}/setting.json`;

Deno.statSync(SETTINGS_FILE_PATH);

export type WebAuthnSetting = {
  rpName: string;
  rpIDType: "variable" | "static";
  rpID?: string;
  attestationType?: AttestationConveyancePreference;
};

type Settings = {
  port?: "env" | number;
  membersEncryption: boolean;
  origins: string[] | string;
  WebAuthn?: WebAuthnSetting;
  getPort: () => number;
};

const settings = JSON.parse(
  Deno.readTextFileSync(SETTINGS_FILE_PATH),
) as Settings;

settings.getPort = () => {
  let port: number | undefined;
  if (typeof settings.port === "string") {
    port = settings.port === "env" ? Number(Deno.env.get("PORT")) : undefined;
  } else {
    port = settings.port;
  }
  return port || 3456;
};

export const getSettings = () => settings;
