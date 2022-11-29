import { generateVAPIDKeys } from "../../utils/utils.ts";

export interface SettingWebPushValues {
  publicKey: string;
  privateKey: string;
  contactInfo?: string;
}

const DEFAULT_SETTINGS_VALUE_WEBPUSH: SettingWebPushValues =
  await generateVAPIDKeys().then((keys) => ({ ...keys }));

export class WebPushSettings {
  values: SettingWebPushValues;

  constructor(values: SettingWebPushValues = DEFAULT_SETTINGS_VALUE_WEBPUSH) {
    this.values = values;
  }
  getRawValue = () => this.values;
}
