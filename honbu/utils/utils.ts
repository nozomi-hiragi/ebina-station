import * as base64url from "std/encoding/base64url.ts";
import { logger } from "./log.ts";

export const mkdirIfNotExist = (path: string) => {
  try {
    return Deno.statSync(path);
  } catch {
    Deno.mkdirSync(path, { recursive: true });
  }
};

export const isExist = (path: string) => {
  try {
    return Deno.statSync(path);
  } catch {
    return undefined;
  }
};

export class HttpException extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const randomBase64url = (len: number) => {
  const bytes = new Uint8Array((len * 6) / 8);
  crypto.getRandomValues(bytes);
  return base64url.encode(bytes);
};

export class ReaderBuffer {
  _reader: Deno.Reader;
  _buffer: Uint8Array;
  _decoder = new TextDecoder();
  _msg = "";

  constructor(reader: Deno.Reader, size = 4096) {
    this._reader = reader;
    this._buffer = new Uint8Array(size);
  }
  _decode = () => this._decoder.decode(this._buffer);

  async read() {
    const ret = await this._reader.read(this._buffer);
    if (ret === null) return null;
    return this._msg = this._decode().slice(0, ret).trim();
  }

  message = () => this._msg;
}

export class RunCommandException extends Error {
  command: string;
  status: number;
  output: string;
  errorOutput: string;
  constructor(
    command: string,
    status: number,
    output: string,
    errorOutput: string,
  ) {
    super(`${command}\nstatus: ${status}\no: ${output}\ne: ${errorOutput}`);
    this.command = command;
    this.output = output;
    this.errorOutput = errorOutput;
    this.status = status;
  }
}

export const runCommand = async (cmd: string[]) => {
  const process = Deno.run({ cmd, stdout: "piped", stderr: "piped" });
  const status = await process.status();
  const decoder = new TextDecoder();
  const output = decoder.decode(await process.output());
  const err = decoder.decode(await process.stderrOutput());
  if (status.code !== 0) {
    throw new RunCommandException(
      cmd.join(" "),
      status.code,
      output,
      err,
    );
  }

  return { output, err, status };
};

export const caller = () => {
  const err = new Error();
  const stackLines = err.stack?.split("\n");
  if (!stackLines) return;
  for (let i = 3; i < stackLines.length; i++) {
    const current = stackLines[i];
    const idxFile = current.indexOf("(file://");
    if (idxFile === -1) continue;
    const idxLineSeparator = current.indexOf(":", idxFile + 8);
    const func = current.substring(current.indexOf("at ") + 3, idxFile);
    const file = current.substring(idxFile + 1, idxLineSeparator);
    const line = current.substring(idxLineSeparator + 1, current.indexOf(")"));
    return { func, file, line };
  }
};

export const createKey = () =>
  window.crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-512" },
    true,
    ["verify", "sign"],
  );

export const loadKey = (filename: string) =>
  Deno.readTextFile(filename).then((keyString) => {
    return crypto.subtle.importKey(
      "jwk",
      JSON.parse(keyString),
      { name: "HMAC", hash: "SHA-512" },
      true,
      ["verify", "sign"],
    );
  }).catch((err) => {
    logger.error(`load ${filename} key error:`, err);
    return undefined;
  });

export const saveKey = (filename: string, key: CryptoKey) =>
  crypto.subtle.exportKey("jwk", key).then((exportedKey) =>
    Deno.writeTextFileSync(filename, `${JSON.stringify(exportedKey)}`)
  );

export const generateVAPIDKeys = async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );

  const publicKey = base64url.encode(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  const privateKey = (
    await crypto.subtle.exportKey("jwk", keyPair.privateKey)
  ).d!;

  return { publicKey, privateKey };
};
