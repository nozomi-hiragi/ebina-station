import { isAbsolute, join, relative, resolve, SEPARATOR } from "@std/path";

/** 見つかったリンクの種類と、dir からの相対パス */
type FoundLink = { kind: "symlink" | "hardlink"; path: string };

/**
 * dir の中（深さを問わず）にあるシンボリックリンクか、リンク数が 2 以上の通常ファイル（ハードリンク）を 1 つ探す。
 * 無ければ undefined。リンクの先はたどらない。nlink が null の OS ではハードリンクは確かめない。
 */
async function findLink(dir: string): Promise<FoundLink | undefined> {
  const pending = [""];
  while (pending.length > 0) {
    const relative = pending.pop() ?? "";
    try {
      for await (const entry of Deno.readDir(relative === "" ? dir : join(dir, relative))) {
        const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (entry.isSymlink) return { kind: "symlink", path };
        if (entry.isDirectory) {
          pending.push(path);
        } else if (entry.isFile) {
          const info = await Deno.lstat(join(dir, path));
          if (info.isFile && info.nlink !== null && info.nlink > 1) return { kind: "hardlink", path };
        }
      }
    } catch (error) {
      // 調べている間に消えたフォルダは、調べる対象から外れただけ
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return undefined;
}

/**
 * dir 自体がシンボリックリンクか、dir の中にシンボリックリンクかハードリンク（リンク数 2 以上の通常ファイル）が
 * あるときの理由を日本語で返す。無ければ null。dir が無いときも null。
 *
 * Deno のパスの権限は、リンクの先を解決せずに判定する。そのため許可したフォルダの中にあるシンボリックリンクは、
 * 先がどこでも読めてしまう。ハードリンクも、project の外のファイルと同じ中身を読み書きできてしまう。
 * 子プロセスに権限を渡すフォルダには、どちらも置かせない。
 *
 * @param label 理由に入れるフォルダの呼び名（例: アプリのフォルダ）
 */
export async function symlinkProblem(dir: string, label: string): Promise<string | null> {
  try {
    if ((await Deno.lstat(dir)).isSymlink) return `${label}がシンボリックリンクです。リンクは置けません`;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
  const found = await findLink(dir);
  if (found === undefined) return null;
  if (found.kind === "hardlink") {
    return `${label}にハードリンクがあります（${found.path}）。project の外のファイルを読み書きできてしまうため、置けません`;
  }
  return `${label}にシンボリックリンクがあります（${found.path}）。リンクの先は権限で絞れないため、置けません`;
}

/**
 * root（project フォルダ）の中で、root から path までの途中のフォルダと path 自体のどれかがシンボリックリンクなら、
 * 理由を日本語で返す。無ければ null。root 自体と、まだ無い段は見ない（無い段は mkdir が本物のフォルダとして作る）。
 * path が root の外なら null（この関数の対象外）。
 *
 * `project/apps` や `project/data/apps` がリンクだと、その先（project の外）に権限を渡してしまうため、作る前・使う前に確かめる。
 */
export async function symlinkInChain(root: string, path: string, label: string): Promise<string | null> {
  const absRoot = resolve(root);
  const rel = relative(absRoot, resolve(path));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  let current = absRoot;
  for (const part of rel.split(SEPARATOR)) {
    current = join(current, part);
    try {
      if ((await Deno.lstat(current)).isSymlink) {
        return `${label}までの途中（${
          relative(absRoot, current)
        }）がシンボリックリンクです。project の外に権限を渡さないよう、起動しません`;
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  }
  return null;
}
