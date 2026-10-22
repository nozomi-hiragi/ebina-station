import QRCode from "qrcode";

/** 端末に出せる QR コード（半角ブロック文字）にする */
export function renderQr(url: string): Promise<string> {
  return QRCode.toString(url, { type: "terminal", small: true });
}
