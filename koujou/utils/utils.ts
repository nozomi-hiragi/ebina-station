export const mkdirIfNotExist = async (path: string) => {
  try {
    await Deno.stat(path);
    return undefined;
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
