import { dirname, join } from "@std/path";
import { isValidName } from "./names.ts";

const EXTENSION = ".bina";

/** ビネットの名前が正しくないときに投げる */
export class InvalidNameError extends Error {
  constructor(name: string) {
    super(`ビネットの名前が正しくありません: ${JSON.stringify(name)}`);
    this.name = "InvalidNameError";
  }
}

/** ビネットの件数の上限。一覧の応答（名前は最大 200 文字なので 1000 件で約 200 KB）が中継の 1 MiB に収まる数 */
export const BINETTE_MAX_COUNT = 1000;

/** write の結果。exists は createOnly で既にあった、full は件数が上限で新しく作れなかった */
export type WriteResult = "created" | "updated" | "exists" | "full";

export interface WriteOptions {
  /** true なら、既にあるときは書かずに "exists" を返す */
  createOnly?: boolean;
}

/** データフォルダの binette/ にビネットの JSON 文字列を保存する。ファイルは `<名前>.bina` */
export class BinetteStore {
  readonly #root: string;
  readonly #maxCount: number;
  /** 保存と削除を 1 つずつ行うための Promise の列 */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string, maxCount: number = BINETTE_MAX_COUNT) {
    this.#root = join(dataDir, "binette");
    this.#maxCount = maxCount;
  }

  /** 保存と削除を 1 つずつ行う（フォルダの片付けと一時ファイルの書き込み、作成の判定が重ならないように） */
  #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(task);
    this.#queue = result.catch(() => {});
    return result;
  }

  #pathOf(name: string): string {
    // 名前の規則に合うものだけをパスにする（.. や区切り文字を含むものは、ここで止まる）
    if (!isValidName(name)) throw new InvalidNameError(name);
    return join(this.#root, ...name.split("/")) + EXTENSION;
  }

  /** 名前の一覧（名前順）。形式に合わないファイルやシンボリックリンクは含めない */
  async list(): Promise<string[]> {
    const names: string[] = [];
    const pending = [""];
    while (pending.length > 0) {
      const relative = pending.pop() ?? "";
      try {
        for await (const entry of Deno.readDir(relative === "" ? this.#root : join(this.#root, relative))) {
          const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
          if (entry.isSymlink) continue;
          if (entry.isDirectory) pending.push(path);
          else if (entry.isFile && entry.name.endsWith(EXTENSION)) {
            const name = path.slice(0, -EXTENSION.length);
            if (isValidName(name)) names.push(name);
          }
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** 保存した JSON 文字列をそのまま返す。無ければ null */
  async read(name: string): Promise<string | null> {
    const path = this.#pathOf(name);
    try {
      const info = await Deno.lstat(path);
      if (!info.isFile) return null;
      return await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.NotADirectory) return null;
      throw error;
    }
  }

  /**
   * 一時ファイルに書いてから rename で置き換える。新しく作ったなら "created"、上書きなら "updated"。
   * 新しく作るときに件数が上限なら "full"、createOnly で既にあれば "exists"（どちらも書かない）
   */
  async write(name: string, text: string, options: WriteOptions = {}): Promise<WriteResult> {
    const path = this.#pathOf(name);
    return await this.#exclusive(async () => {
      const existed = await this.read(name) !== null;
      if (existed && options.createOnly === true) return "exists";
      if (!existed && (await this.list()).length >= this.#maxCount) return "full";
      await Deno.mkdir(dirname(path), { recursive: true });
      const temp = `${path}.tmp-${crypto.randomUUID()}`;
      try {
        await Deno.writeTextFile(temp, text, { createNew: true });
        await Deno.rename(temp, path);
      } catch (error) {
        await Deno.remove(temp).catch(() => {});
        throw error;
      }
      return existed ? "updated" : "created";
    });
  }

  /** 消す。消したなら true、無ければ false。空になったフォルダは binette/ の手前まで片付ける */
  async remove(name: string): Promise<boolean> {
    const path = this.#pathOf(name);
    return await this.#exclusive(() => this.#removeNow(path));
  }

  async #removeNow(path: string): Promise<boolean> {
    try {
      await Deno.remove(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.NotADirectory) return false;
      throw error;
    }
    let dir = dirname(path);
    while (dir.length > this.#root.length && dir.startsWith(this.#root)) {
      try {
        await Deno.remove(dir);
      } catch {
        break; // 空でない（ほかのビネットがある）か、すでに無い
      }
      dir = dirname(dir);
    }
    return true;
  }
}
