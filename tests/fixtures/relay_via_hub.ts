/**
 * hub から echo アプリへ 1 回中継して、結果を標準出力に JSON で出す。
 * HTTP_PROXY などの環境変数を付けて起動し直したいので、テストとは別のプロセスで動かす（tests/hub.test.ts）。
 * 引数: project フォルダ（apps/echo がある）
 */
import { createAppHub } from "../../src/apps/hub.ts";
import { setLogSink } from "../../src/log.ts";
import { projectPaths } from "../../src/paths.ts";

setLogSink(() => {});
const hub = createAppHub({ paths: projectPaths(Deno.args[0]), states: { isEnabled: () => true } });
try {
  await hub.start();
  const response = await hub.relay(
    "echo",
    "/hello?x=1",
    { method: "GET", url: "wake://station/echo/hello?x=1", headers: [], body: new Uint8Array() },
    "alice",
  );
  console.log(JSON.stringify({ status: response.status, body: new TextDecoder().decode(response.body) }));
} finally {
  await hub.stop();
}
