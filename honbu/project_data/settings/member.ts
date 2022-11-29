export interface SettingMemberValues {
  allowRegist: boolean;
  maxMembers: number;
  // membersEncryption: boolean;
}

const DEFAULT_SETTINGS_VALUE_MEMBER: SettingMemberValues = {
  allowRegist: true,
  maxMembers: 1,
};

export class MemberSettings {
  values: SettingMemberValues;

  constructor(values: SettingMemberValues = DEFAULT_SETTINGS_VALUE_MEMBER) {
    this.values = values;
  }
  getRawValue = () => this.values;

  canRegistNewMember(currentMemberCount: number) {
    return this.values.allowRegist &&
      (this.values.maxMembers > currentMemberCount);
  }
}
