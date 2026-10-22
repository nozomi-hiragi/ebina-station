/**
 * テスト用の埋め込みアプリ。受けたリクエストをそのまま JSON で返す。
 *
 * 通常の応答（`/__probe/` 以外のすべてのパス）:
 *   { method, path, body, headerNames, headers, ebinaUser, hasAppToken }
 *   - path: パスとクエリ（例 "/hello?x=1"）
 *   - body: 本文の文字列
 *   - headerNames: 受けたヘッダー名（小文字、並べ替え済み）
 *   - headers: 受けたヘッダーの名前（小文字）と値。ebina-app-token は値を返さず、載せない
 *   - ebinaUser: Ebina-User の値。無ければ null
 *   - hasAppToken: Ebina-App-Token が来たか（値は返さない）
 *
 * 権限や動作を確かめる口（`/__probe/…`）:
 *   - pid: { pid }
 *   - write: データフォルダに書いて読み戻す { ok: true, content }
 *   - read?path=<絶対パス>: そのファイルを読む。許されなければ { ok: false, error: <エラー名> }
 *   - write-outside: アプリのフォルダへ書こうとする { ok, error? }
 *   - net: 許可されていない宛先へつなごうとする { external, loopback, connect }（それぞれ { ok, error? }）
 *   - env: 許可された環境変数と、許可されていない環境変数（HOME）を読む
 *   - run: 子プロセスを起こそうとする { ok, error? }
 *   - response-headers: Set-Cookie や Ebina- で始まるヘッダーを付けて返す
 *   - big?size=<バイト数>: その大きさの本文を返す（4 MiB まで）
 *   - crash: 応答したあと、終了コード 3 で終わる
 */

interface Outcome {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function attempt(action: () => unknown): Promise<Outcome> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.name : String(error) };
  }
}

async function probe(name: string, url: URL): Promise<Response> {
  const dataDir = Deno.env.get("EBINA_DATA_DIR") ?? "";
  switch (name) {
    case "pid":
      return Response.json({ pid: Deno.pid });
    case "write": {
      const path = `${dataDir}/probe.txt`;
      await Deno.writeTextFile(path, "データフォルダに書けた");
      return Response.json({ ok: true, content: await Deno.readTextFile(path) });
    }
    case "read":
      return Response.json(await attempt(() => Deno.readTextFile(url.searchParams.get("path") ?? "")));
    case "write-outside":
      return Response.json(
        await attempt(() =>
          Deno.writeTextFile(new URL("evil.txt", import.meta.url), "アプリのフォルダへ書けてしまった")
        ),
      );
    case "net":
      return Response.json({
        external: await attempt(() => fetch("http://example.com/")),
        loopback: await attempt(() => fetch("http://127.0.0.1:65000/")),
        connect: await attempt(() => Deno.connect({ hostname: "example.com", port: 80 })),
      });
    case "env":
      return Response.json({
        dataDir: await attempt(() => Deno.env.get("EBINA_DATA_DIR") === dataDir && dataDir !== ""),
        home: await attempt(() => Deno.env.get("HOME")),
        path: await attempt(() => Deno.env.get("PATH")),
      });
    case "run":
      return Response.json(await attempt(() => new Deno.Command("echo", { args: ["x"] }).outputSync()));
    case "response-headers":
      return new Response("headers", {
        headers: [
          ["Set-Cookie", "session=secret"],
          ["Ebina-Secret", "1"],
          ["X-Visible", "yes"],
          ["Content-Type", "text/plain; charset=utf-8"],
        ],
      });
    case "big": {
      const size = Math.min(Number(url.searchParams.get("size") ?? 0), 4 * 1024 * 1024);
      return new Response(new Uint8Array(size).fill(97), { headers: { "Content-Type": "application/octet-stream" } });
    }
    case "crash":
      setTimeout(() => Deno.exit(3), 50);
      return Response.json({ crashing: true });
    default:
      return Response.json({ error: "unknown probe" }, { status: 404 });
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/__probe/")) {
      return await probe(url.pathname.slice("/__probe/".length), url);
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of req.headers) {
      if (name !== "ebina-app-token") headers[name] = value;
    }
    return Response.json({
      method: req.method,
      path: url.pathname + url.search,
      body: await req.text(),
      headerNames: [...req.headers.keys()].sort(),
      headers,
      ebinaUser: req.headers.get("ebina-user"),
      hasAppToken: req.headers.has("ebina-app-token"),
    });
  },
};
