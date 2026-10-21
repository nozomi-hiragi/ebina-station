import type { EtHandlerResponse } from "@wake-protocol/server";

const encoder = new TextEncoder();

/** ET の応答。`content-type: application/json` で、本文は UTF-8 の JSON */
export function etJson(status: number, value: unknown): EtHandlerResponse {
  return {
    status,
    headers: [["content-type", "application/json"]],
    body: encoder.encode(JSON.stringify(value)),
  };
}

/** `{"error":{"code":"…"}}` を返す ET の応答（Station の ET の誤りはすべてこの形） */
export function etError(status: number, code: string): EtHandlerResponse {
  return etJson(status, { error: { code } });
}
