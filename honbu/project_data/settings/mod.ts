import { PROJECT_PATH, SETTINGS_FILE_PATH } from "../mod.ts";
import { MemberSettings, SettingMemberValues } from "./member.ts";
import { MongodbSettings, SettingMongodbValues } from "./mongodb.ts";
import { SettingWebAuthnValues, WebAuthnSettings } from "./webauthn.ts";
import { SettingWebPushValues, WebPushSettings } from "./webpush.ts";

const DEFAULT_PORT_NUM = 3456;
const DEFAULT_ORIGINS = [
  "https://nozomi-hiragi.github.io",
  "http://localhost:3000",
];

interface SettingsValues {
  port: "env" | number;
  origins: string[];

  Member: SettingMemberValues;
  WebAuthn: SettingWebAuthnValues;
  Mongodb: SettingMongodbValues;
  WebPush: SettingWebPushValues;
}

export class Settings {
  private static _instance: Settings;
  static instance() {
    if (!this._instance) this._instance = new Settings();
    return this._instance;
  }
  private constructor() {}

  private port: "env" | number = DEFAULT_PORT_NUM;
  origins = DEFAULT_ORIGINS;

  Member = new MemberSettings();
  WebAuthn = new WebAuthnSettings();
  Mongodb = new MongodbSettings();
  WebPush = new WebPushSettings();

  fromValies(values: SettingsValues) {
    this.port = values.port;
    this.origins = values.origins;
    this.Member = new MemberSettings(values.Member);
    this.WebAuthn = new WebAuthnSettings(values.WebAuthn);
    this.Mongodb = new MongodbSettings(values.Mongodb);
    this.WebPush = new WebPushSettings(values.WebPush);
  }

  toValues(): SettingsValues {
    return {
      port: this.port,
      origins: this.origins,
      Member: this.Member.getRawValue(),
      WebAuthn: this.WebAuthn.getRawValue(),
      Mongodb: this.Mongodb.getRawValue(),
      WebPush: this.WebPush.getRawValue(),
    };
  }

  load() {
    try {
      const values = JSON.parse(
        Deno.readTextFileSync(SETTINGS_FILE_PATH),
      ) as SettingsValues;
      this.fromValies(values);
      return true;
    } catch {
      return false;
    }
  }

  save() {
    try {
      Deno.mkdirSync(PROJECT_PATH, { recursive: true });
      Deno.writeTextFileSync(
        SETTINGS_FILE_PATH,
        JSON.stringify(this.toValues(), undefined, 2),
      );
      return true;
    } catch (err) {
      console.error(err);
      return false;
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
}
