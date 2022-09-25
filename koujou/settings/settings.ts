import { AttestationConveyancePreference } from "../utils/webauthn/types.ts";

export const PROJECT_PATH = "./project";
export const APPS_DIR = `${PROJECT_PATH}/apps`;
export const NGINX_DIR = `${PROJECT_PATH}/nginx`;
export const GOMI_DIR = `${PROJECT_PATH}/gomi`;

const SETTINGS_FILE_PATH = `${PROJECT_PATH}/settings.json`;
const DEFAULT_PORT_NUM = 3456;
const DEFAULT_HONBU_PORT_NUM = 9876;
const DEFAULT_MONGODB_PORT = 27017;

type WebAuthnSetting = {
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
  port?: "env" | number;
  honbuPort?: number;
  // membersEncryption = false;
  origins: string[] | string = [];
  WebAuthn?: WebAuthnSetting;
  mongodb?: MongoBD;

  constructor(init?: Partial<Settings>) {
    Object.assign(this, init);

    const mongodb = this.mongodb;
    if (mongodb) {
      if (mongodb.port === undefined) mongodb.port = DEFAULT_MONGODB_PORT;
    }
  }

  getPortNumber() {
    if (this.port === "env") {
      const envPort = Number(Deno.env.get("PORT"));
      return Number.isNaN(envPort) ? DEFAULT_PORT_NUM : envPort;
    } else {
      return this.port ?? DEFAULT_PORT_NUM;
    }
  }

  getHonbuPortNumber() {
    return this.honbuPort ?? DEFAULT_HONBU_PORT_NUM;
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

  getMongodbUsername() {
    const mongodb = this.mongodb;
    if (!mongodb) return undefined;
    if (mongodb.username !== "env") return mongodb.username;
    return Deno.env.get("MONGO_INITDB_ROOT_USERNAME");
  }

  getMongodbPassword() {
    const mongodb = this.mongodb;
    if (!mongodb) return undefined;
    if (mongodb.password !== "env") return mongodb.password;
    return Deno.env.get("MONGO_INITDB_ROOT_PASSWORD");
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
