import { join } from "@std/path";

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
