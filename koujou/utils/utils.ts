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
