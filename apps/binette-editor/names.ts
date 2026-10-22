/** ビネットの名前の全体の長さの上限 */
export const NAME_MAX_LENGTH = 200;
/** 名前の 1 つの区切り（`/` で区切った 1 つ）の長さの上限 */
export const SEGMENT_MAX_LENGTH = 64;

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * ビネットの名前として使えない理由を日本語で返す。使えるなら null。
 *
 * 名前は `/` で区切れる。各区切りは 1〜64 文字の `[A-Za-z0-9._-]` で、`.` と `..` は使えない。
 * 全体は 200 文字まで。保存先のパスと URL でそのまま安全に扱えるよう、これ以外の文字は受け付けない。
 * 区切りの末尾が `.bina` になる名前は使えない（保存のときに付けるため。`a.bina/b` のようなフォルダも、ファイル `a.bina` とぶつかる）。
 */
export function nameProblem(name: string): string | null {
  if (typeof name !== "string" || name.length === 0) return "名前が空です";
  if (name.length > NAME_MAX_LENGTH) return `名前は ${NAME_MAX_LENGTH} 文字までです`;
  for (const segment of name.split("/")) {
    if (segment.length === 0) return "名前の区切り（/）が空です。先頭・末尾の / や // は使えません";
    if (segment.length > SEGMENT_MAX_LENGTH) return `名前の 1 つの区切りは ${SEGMENT_MAX_LENGTH} 文字までです`;
    // .bina で終わる区切りはフォルダ名とファイル名がぶつかる（a と a.bina/b）ため、どの区切りにも付けられない
    if (segment.endsWith(".bina")) return "名前の区切りの末尾に .bina は付けられません（保存するときに付きます）";
    if (segment === "." || segment === "..") return "名前の区切りに . と .. は使えません";
    if (!SEGMENT_PATTERN.test(segment)) {
      return "名前に使えるのは、英数字、. _ - と、区切りの / だけです";
    }
  }
  return null;
}

export function isValidName(name: string): boolean {
  return nameProblem(name) === null;
}
