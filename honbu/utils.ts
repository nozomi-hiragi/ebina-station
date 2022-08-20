export const readReader = async (
  reader: Deno.Reader,
  callback: (msg: string) => boolean | undefined | void,
) => {
  const decoder = new TextDecoder();
  const buffer = new Uint8Array(4096);
  while (await reader.read(buffer) !== null) {
    for (const msg of decoder.decode(buffer).split("\n")) {
      if (callback(msg)) return;
    }
  }
};

const getDockerEdition = async () => {
  const process = Deno.run({
    cmd: ["docker", "version", "-f", "'{{.Server.Platform.Name}}'"],
    stdout: "piped",
  });
  const status = await process.status();
  if (!status.success || status.code !== 0) return undefined;
  return new TextDecoder().decode(await process.output()).slice(1, -2);
};

export const isDockerDesktop = async () =>
  await getDockerEdition().then((e) => e?.includes("Desktop") ?? false);
