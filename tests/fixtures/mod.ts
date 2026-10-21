import { dirname, fromFileUrl, join } from "@std/path";
import { type ProjectPaths, projectPaths } from "../../src/paths.ts";

/** tests/fixtures/apps（echo、notes、broken） */
export const FIXTURE_APPS_DIR = fromFileUrl(new URL("./apps/", import.meta.url));

/** 一時フォルダに作った project。使い終わったら dispose() で消す */
export interface TestProject {
  paths: ProjectPaths;
  dispose(): Promise<void>;
}

async function copyDir(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    if (entry.isDirectory) await copyDir(join(from, entry.name), join(to, entry.name));
    else if (entry.isFile) await Deno.copyFile(join(from, entry.name), join(to, entry.name));
  }
}

/** tests/fixtures/apps から apps/ へ写すアプリ。写し先の名前を変えるときは { from, as } で書く */
export type FixtureApp = string | { from: string; as: string };

/** fixtures に挙げたアプリを tests/fixtures/apps から project の apps/ へ写す */
export async function installFixtureApps(paths: ProjectPaths, fixtures: readonly FixtureApp[]): Promise<void> {
  await Deno.mkdir(paths.appsDir, { recursive: true });
  for (const fixture of fixtures) {
    const { from, as } = typeof fixture === "string" ? { from: fixture, as: fixture } : fixture;
    await copyDir(join(FIXTURE_APPS_DIR, from), join(paths.appsDir, as));
  }
}

/**
 * 一時フォルダに project を作る。fixtures に挙げたアプリを apps/ へ写す。
 * 写し先の名前を変えるときは { from, as } で書く（同じアプリを 2 つ置くときなど）。
 */
export async function makeProject(fixtures: readonly FixtureApp[] = []): Promise<TestProject> {
  const root = await Deno.makeTempDir({ prefix: "ebina-test-" });
  const paths = projectPaths(root);
  await installFixtureApps(paths, fixtures);
  return { paths, dispose: () => Deno.remove(root, { recursive: true }) };
}

/** apps/<name>/ にファイルを書く。キーはアプリのフォルダからの相対パス */
export async function writeApp(paths: ProjectPaths, name: string, files: Record<string, string>): Promise<string> {
  const dir = join(paths.appsDir, name);
  for (const [relative, text] of Object.entries(files)) {
    const path = join(dir, relative);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, text);
  }
  return dir;
}

/** predicate が true になるまで待つ。timeoutMs を過ぎたら投げる */
export async function waitFor(predicate: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const limit = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > limit) throw new Error(`時間内に成り立ちませんでした: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** pid のプロセスが生きているか（シグナル SIGCONT は動いているプロセスには何も起こさない） */
export function isProcessAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
