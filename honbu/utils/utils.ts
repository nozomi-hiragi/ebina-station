import { base64 } from "../deps.ts";

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
    return false;
  }
};

export class HttpExeption extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const randomString = (len: number) => {
  const bytes = new Uint8Array((len * 6) / 8);
  crypto.getRandomValues(bytes);
  return base64.encode(bytes);
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

export const readReader = async (
  reader: Deno.Reader,
  callback: (msg: string) => boolean | undefined | void,
) => {
  const rb = new ReaderBuffer(reader);
  while (await rb.read() !== null) {
    for (const msg of rb.message().split("\n")) {
      if (msg.indexOf("\0") === 0) continue;
      if (callback(msg)) return;
    }
  }
};

export class RunCommandExeption extends Error {
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
    throw new RunCommandExeption(
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
