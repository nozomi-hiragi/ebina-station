import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { log, type LogLevel, setLogSink } from "../src/log.ts";

function capture(fn: () => void): { line: string; level: LogLevel }[] {
  const lines: { line: string; level: LogLevel }[] = [];
  setLogSink((line, level) => lines.push({ line, level }));
  try {
    fn();
  } finally {
    setLogSink(undefined);
  }
  return lines;
}

Deno.test("log: 時刻・レベル・メッセージを 1 行にする", () => {
  const lines = capture(() => {
    log.info("起動しました");
    log.warn("警告です");
    log.error("失敗しました");
  });
  assertEquals(lines.map((l) => l.level), ["info", "warn", "error"]);
  assertMatch(lines[0].line, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO {2}起動しました$/);
  assertMatch(lines[1].line, /^\S+ WARN {2}警告です$/);
  assertMatch(lines[2].line, /^\S+ ERROR 失敗しました$/);
});

Deno.test("log: 追加の値は文字列、エラーはスタック、そのほかは整形して後ろに付ける", () => {
  const lines = capture(() => {
    log.error("失敗", new Error("だめ"), "詳細", { a: 1 });
  });
  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0].line, "Error: だめ");
  assertStringIncludes(lines[0].line, "詳細");
  assertStringIncludes(lines[0].line, "{ a: 1 }");
});
