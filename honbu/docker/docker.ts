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
