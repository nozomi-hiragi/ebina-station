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

/** Station がセッションを拒んだ 401 に付けるヘッダー。アプリの応答の `ebina-` ヘッダーは中継で除くので、アプリは偽れない */
export const STATION_ERROR_HEADER = "ebina-station-error";

/** Station がセッションを拒んだときの 401。ebina-front はこのヘッダーを見てログイン画面へ戻る */
export function etUnauthorized(): EtHandlerResponse {
  const res = etError(401, "unauthorized");
  return { ...res, headers: [...(res.headers ?? []), [STATION_ERROR_HEADER, "unauthorized"]] };
}
