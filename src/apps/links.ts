import { isAbsolute, join, relative, resolve, SEPARATOR } from "@std/path";

/**
 * dir の中（深さを問わず）にあるシンボリックリンクを 1 つ探し、dir からの相対パスで返す。無ければ undefined。
 * リンクの先はたどらない。
 */
async function findSymlink(dir: string): Promise<string | undefined> {
  const pending = [""];
  while (pending.length > 0) {
    const relative = pending.pop() ?? "";
    try {
      for await (const entry of Deno.readDir(relative === "" ? dir : join(dir, relative))) {
        const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (entry.isSymlink) return path;
        if (entry.isDirectory) pending.push(path);
      }
    } catch (error) {
      // 調べている間に消えたフォルダは、調べる対象から外れただけ
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return undefined;
}

/**
 * dir 自体がシンボリックリンクか、dir の中にシンボリックリンクがあるときの理由を日本語で返す。無ければ null。
 * dir が無いときも null。
 *
 * Deno のパスの権限は、リンクの先を解決せずに判定する。そのため許可したフォルダの中にあるリンクは、
 * 先がどこでも読めてしまう。子プロセスに権限を渡すフォルダには、リンクを置かせない。
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
  const found = await findSymlink(dir);
  if (found === undefined) return null;
  return `${label}にシンボリックリンクがあります（${found}）。リンクの先は権限で絞れないため、置けません`;
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
