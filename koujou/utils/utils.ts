import { base64 } from "../deps.ts";

export const mkdirIfNotExist = (path: string) => {
  try {
    return Deno.statSync(path);
  } catch {
    Deno.mkdirSync(path, { recursive: true });
  }
};

export const exist = (path: string) => {
  try {
    Deno.statSync(path);
    return true;
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
