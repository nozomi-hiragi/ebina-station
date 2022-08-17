class DockerCommandUp {
  containerName: string;
  detach: boolean;
  constructor(containerName: string, detach: boolean = true) {
    this.containerName = containerName;
    this.detach = detach;
  }
}

class DockerCommandRm {
  containerName: string;
  forceRemove: boolean;
  beforeStop: boolean;
  constructor(
    containerName: string,
    forceRemove: boolean = true,
    beforeStop: boolean = true,
  ) {
    this.containerName = containerName;
    this.forceRemove = forceRemove;
    this.beforeStop = beforeStop;
  }
}

type DockerComposeCommand = DockerCommandUp | DockerCommandRm;

const buildDockerComposeCommand = (command: DockerComposeCommand) => {
  const cmd = ["docker-compose"] as string[];
  if (command instanceof DockerCommandUp) {
    if (command.containerName === "") throw new Error("no container name");
    cmd.push("up");
    if (command.detach) cmd.push("-d");
    cmd.push(command.containerName);
  } else if (command instanceof DockerCommandRm) {
    if (command.containerName === "") throw new Error("no container name");
    cmd.push("rm");
    if (command.forceRemove) cmd.push("-f");
    if (command.beforeStop) cmd.push("-s");
    cmd.push(command.containerName);
  }
  return cmd;
};

const execDockerCompose = async (command: DockerComposeCommand) => {
  const cmd = buildDockerComposeCommand(command);
  const process = Deno.run({ cmd, stderr: "piped" });
  const status = await process.status();
  if (status.code !== 0) {
    console.log(new TextDecoder().decode(await process.stderrOutput()));
  }

  return status.success;
};

export const upService = (containerName: string) =>
  execDockerCompose(new DockerCommandUp(containerName));

export const rmService = (containerName: string) =>
  execDockerCompose(new DockerCommandRm(containerName));
