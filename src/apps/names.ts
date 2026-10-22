/** アプリ名の形式。英小文字で始まり、英小文字・数字・`-` だけで 63 文字まで */
export const APP_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

/** Station が使うパスと重なるため、アプリ名にできない名前 */
export const RESERVED_APP_NAMES: readonly string[] = ["index", "settings", "station", "me", "ebina"];

/** 形式だけを調べる（予約名は調べない） */
export function isAppNameFormat(name: string): boolean {
  return typeof name === "string" && APP_NAME_PATTERN.test(name);
}

export function isReservedAppName(name: string): boolean {
  return RESERVED_APP_NAMES.includes(name);
}

/** アプリ名として使えるか（形式に合い、予約名でない） */
export function isValidAppName(name: string): boolean {
  return isAppNameFormat(name) && !isReservedAppName(name);
}

/** 使えない理由を日本語で返す。使えるなら null */
export function validateAppName(name: string): string | null {
  if (typeof name !== "string" || name.length === 0) return "アプリ名が空です";
  if (!isAppNameFormat(name)) {
    return "アプリ名は英小文字で始め、英小文字・数字・- だけで 63 文字以内にしてください";
  }
  if (isReservedAppName(name)) {
    return `「${name}」は予約されているため、アプリ名に使えません`;
  }
  return null;
}
