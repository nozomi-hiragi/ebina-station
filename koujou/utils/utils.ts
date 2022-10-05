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
