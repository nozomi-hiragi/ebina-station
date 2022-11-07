import { AttestationConveyancePreference } from "../utils/webauthn/fido2Wrap.ts";

export const PROJECT_PATH = "./project";
export const APPS_DIR = `${PROJECT_PATH}/apps`;
export const NGINX_DIR = `${PROJECT_PATH}/nginx`;
export const GOMI_DIR = `${PROJECT_PATH}/gomi`;

const SETTINGS_FILE_PATH = `${PROJECT_PATH}/settings.json`;
const DEFAULT_PORT_NUM = 3456;
const DEFAULT_MONGODB_PORT = 27017;

export type WebAuthnSetting = {
  rpName: string;
  rpIDType: "variable" | "static";
  rpID?: string;
  attestationType?: AttestationConveyancePreference;
};

export type MongoBD = {
  port: number;
  username: "env" | string;
  password: "env" | string;
  databaseFilter: { [databaseName: string]: { enable: boolean } };
};

class Settings {
  port: "env" | number = DEFAULT_PORT_NUM;
  origins: string[] = [
    "https://nozomi-hiragi.github.io",
    "http://localhost:3000",
  ];
  Member = {
    allowRegist: true,
    maxMembers: 1,
    // membersEncryption = false;
  };
  WebAuthn: WebAuthnSetting = {
    rpName: "EbinaStation",
    rpIDType: "variable",
  };
  MongoDB: MongoBD = {
    port: DEFAULT_MONGODB_PORT,
    username: "env",
    password: "env",
    databaseFilter: {
      admin: { enable: true },
      config: { enable: true },
      local: { enable: true },
    },
  };

  constructor(init?: Partial<Settings>) {
    if (init) Object.assign(this, init);
  }

  getPortNumber() {
    if (this.port === "env") {
      const envPort = Number(Deno.env.get("PORT"));
      return Number.isNaN(envPort) ? DEFAULT_PORT_NUM : envPort;
    } else {
      return this.port ?? DEFAULT_PORT_NUM;
    }
  }

  hasWebAuthn = () => this.WebAuthn !== undefined;

  isRPIDStatic() {
    switch (this.WebAuthn?.rpIDType) {
      case "variable":
        return false;
      default:
      case "static":
        return true;
    }
  }

  getWebAuthnRPID(origin: string) {
    if (!this.WebAuthn) return undefined;
    const { hostname } = new URL(origin);
    const rpID = settings.isRPIDStatic() ? this.WebAuthn.rpID : hostname;
    return rpID;
  }

  getMongodbUsername() {
    const mongodb = this.MongoDB;
    if (!mongodb) return undefined;
    if (mongodb.username !== "env") return mongodb.username;
    return Deno.env.get("MONGO_INITDB_ROOT_USERNAME");
  }

  getMongodbPassword() {
    const mongodb = this.MongoDB;
    if (!mongodb) return undefined;
    if (mongodb.password !== "env") return mongodb.password;
    return Deno.env.get("MONGO_INITDB_ROOT_PASSWORD");
  }

  canRegistNewMember(currentMemberCount: number) {
    const settings = this.Member;
    console.log(
      `${settings.allowRegist} ${settings.maxMembers} ${currentMemberCount}`,
    );
    return settings.allowRegist && (settings.maxMembers > currentMemberCount);
  }
}

let settings: Settings;

const loadFromFile = () => {
  let settings: Settings;
  try {
    settings = new Settings(
      JSON.parse(Deno.readTextFileSync(SETTINGS_FILE_PATH)),
    );
  } catch {
    Deno.mkdirSync(PROJECT_PATH, { recursive: true });
    settings = new Settings();
  }
  Deno.writeTextFileSync(
    SETTINGS_FILE_PATH,
    JSON.stringify(settings, undefined, 2),
  );
  return settings;
};

export const getSettings = () => settings ?? (settings = loadFromFile());

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
