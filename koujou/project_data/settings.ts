import { PROJECT_PATH } from "../ebinaAPI/app/index.ts";
import { AttestationConveyancePreference } from "../utils/webauthn/types.ts";

const SETTINGS_FILE_PATH = `${PROJECT_PATH}/settings.json`;

type WebAuthnSetting = {
  rpName: string;
  rpIDType: "variable" | "static";
  rpID?: string;
  attestationType?: AttestationConveyancePreference;
};

export type MongoBD = {
  hostname: string;
  port: number;
  username: "env" | string;
  password: "env" | string;
};

class Settings {
  port?: "env" | number;
  // membersEncryption = false;
  origins: string[] | string = [];
  WebAuthn?: WebAuthnSetting;
  mongodb?: MongoBD;

  constructor(init?: Partial<Settings>) {
    Object.assign(this, init);
  }

  getPort() {
    let port: number | undefined;
    if (typeof settings.port === "string") {
      port = settings.port === "env" ? Number(Deno.env.get("PORT")) : undefined;
    } else {
      port = settings.port;
    }
    return port || 3456;
  }

  isRPIDStatic() {
    switch (this.WebAuthn?.rpIDType) {
      case "variable":
        return false;
      default:
      case "static":
        return true;
    }
  }
}

let settings: Settings = (() => {
  try {
    return new Settings(
      JSON.parse(Deno.readTextFileSync(SETTINGS_FILE_PATH)),
    );
  } catch {
    const settings = new Settings();
    Deno.writeTextFileSync(
      SETTINGS_FILE_PATH,
      JSON.stringify(settings, undefined, 2),
    );
    return settings;
  }
})();

export const getSettings = () => settings;

const saveToFile = () => {
  if (!settings) return false;
  try {
    Deno.writeTextFileSync(
      SETTINGS_FILE_PATH,
      JSON.stringify(settings, undefined, 2),
    );
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
};

export const setSettings = (newSettings: Settings) => {
  settings = newSettings;
  return saveToFile();
};
