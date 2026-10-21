import type { SQLOutputValue } from "node:sqlite";

/** node:sqlite が返す行。値の型は列ごとに確かめてから使う */
export type Row = Record<string, SQLOutputValue>;

function bad(column: string, expected: string, value: unknown): Error {
  return new Error(`DB の列 ${column} が ${expected} ではありません: ${Deno.inspect(value)}`);
}

export function rowString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw bad(column, "文字列", value);
  return value;
}

export function rowOptionalString(row: Row, column: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw bad(column, "文字列", value);
  return value;
}

export function rowNumber(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number") throw bad(column, "数値", value);
  return value;
}

export function rowBool(row: Row, column: string): boolean {
  return rowNumber(row, column) !== 0;
}

/** BLOB を Uint8Array のコピーで返す（呼び出し側が書き換えても DB の読み出し結果に影響しない） */
export function rowBytes(row: Row, column: string): Uint8Array {
  const value = row[column];
  if (!(value instanceof Uint8Array)) throw bad(column, "BLOB", value);
  return value.slice();
}
