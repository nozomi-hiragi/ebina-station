export type LogLevel = "info" | "warn" | "error";

/** 出力先。line は時刻とレベルを付けた 1 行 */
export type LogSink = (line: string, level: LogLevel) => void;

const defaultSink: LogSink = (line, level) => {
  if (level === "info") console.log(line);
  else console.error(line);
};

let sink: LogSink = defaultSink;

/** 出力先を差し替える。undefined で標準に戻す（テストで黙らせたり、集めたりするため） */
export function setLogSink(next: LogSink | undefined): void {
  sink = next ?? defaultSink;
}

function formatDetail(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  return Deno.inspect(value, { compact: true, depth: 4 });
}

function write(level: LogLevel, message: string, detail: unknown[]): void {
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), message, ...detail.map(formatDetail)];
  sink(parts.join(" "), level);
}

/** 秘密（トークン、secret、パスキーの情報）は渡さないこと */
export const log = {
  info: (message: string, ...detail: unknown[]): void => write("info", message, detail),
  warn: (message: string, ...detail: unknown[]): void => write("warn", message, detail),
  error: (message: string, ...detail: unknown[]): void => write("error", message, detail),
};
