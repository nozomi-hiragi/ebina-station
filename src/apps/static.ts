import { createCoulisses, importPanoplie } from "@binette/coulisses";
import type { EtHandlerResponse } from "@wake-protocol/server";
import { join } from "@std/path";
import { log } from "../log.ts";
import { badGateway, notFound, RELAY_BODY_MAX, toEtResponse } from "./relay.ts";

/** panoplie/ の中身を配るもの。作った時点の中身で応える（作り直すには createStaticSite をやり直す） */
export interface StaticSite {
  /** path は `/` 始まりでクエリを含んでよい。GET と HEAD 以外は Coulisses が 405 を返す */
  handle(method: string, path: string): Promise<EtHandlerResponse>;
}

/** dir の中で、max バイトを超える最初のファイルを dir からの相対パスで返す。無ければ undefined */
async function findLargeFile(dir: string, max: number): Promise<string | undefined> {
  const pending = [""];
  while (pending.length > 0) {
    const relative = pending.pop() ?? "";
    for await (const entry of Deno.readDir(relative === "" ? dir : join(dir, relative))) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory) pending.push(path);
      else if (entry.isFile && (await Deno.stat(join(dir, path))).size > max) return path;
    }
  }
  return undefined;
}

/**
 * panoplie/ のフォルダを読んで、`@binette/coulisses` で配るものを作る。
 * ET で運べる本文の上限（1 MiB）を超えるファイルは配れないため、読み込む前に見つけて投げる
 * （読み込むと、配れないものがメモリに残り続ける）。
 *
 * @param name ログに出すアプリ名
 * @throws {Error} 読めない・大きすぎるファイルがある・ビネットの形式が正しくないとき
 */
export async function createStaticSite(panoplieDir: string, name = "(panoplie)"): Promise<StaticSite> {
  const large = await findLargeFile(panoplieDir, RELAY_BODY_MAX);
  if (large !== undefined) {
    throw new Error(`${large} が大きすぎます（ファイルは ${RELAY_BODY_MAX / 1024 / 1024} MiB まで）`);
  }
  const coulisses = createCoulisses({ panoplie: await importPanoplie(panoplieDir) });
  return {
    async handle(method, path) {
      let request: Request;
      try {
        request = new Request(`http://app${path}`, { method });
      } catch {
        return notFound();
      }
      try {
        return await toEtResponse(await coulisses.fetch(request), RELAY_BODY_MAX, name);
      } catch (error) {
        // 例外にはファイルのパスが入りうるが、クエリは入らない
        log.error(`アプリ ${name} の panoplie/ の配信で例外が起きました`, error);
        return badGateway();
      }
    },
  };
}
