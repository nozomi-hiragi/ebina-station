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

class DockerCommandRestart {
  containerName: string;
  timeout?: number;
  constructor(containerName: string, timeout?: number) {
    this.containerName = containerName;
    this.timeout = timeout;
  }
}

class DockerCommandPs {
  containerName: string;
  quiet?: boolean;
  constructor(containerName: string, quiet?: boolean) {
    this.containerName = containerName;
    this.quiet = quiet;
  }
}

type DockerComposeCommand =
  | DockerCommandUp
  | DockerCommandRm
  | DockerCommandRestart
  | DockerCommandPs;

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
  } else if (command instanceof DockerCommandRestart) {
    if (command.containerName === "") throw new Error("no container name");
    cmd.push("restart");
    if (command.timeout) {
      cmd.push("-t");
      cmd.push(`${command.timeout}`);
    }
    cmd.push(command.containerName);
  } else if (command instanceof DockerCommandPs) {
    if (command.containerName === "") throw new Error("no container name");
    cmd.push("ps");
    if (command.quiet) cmd.push("-q");
    cmd.push(command.containerName);
  }
  return cmd;
};

const execDockerCompose = async (command: DockerComposeCommand) => {
  const cmd = buildDockerComposeCommand(command);
  const process = Deno.run({ cmd, stdout: "piped", stderr: "piped" });
  const status = await process.status();
  const output = new TextDecoder().decode(await process.output());
  if (status.code !== 0) {
    throw new TextDecoder().decode(await process.stderrOutput());
  }

  return { output, ...status };
};

export const upService = (containerName: string) =>
  execDockerCompose(new DockerCommandUp(containerName));

export const rmService = (containerName: string) =>
  execDockerCompose(new DockerCommandRm(containerName));

export const restartService = (containerName: string) =>
  execDockerCompose(new DockerCommandRestart(containerName));

export const psService = (containerName: string) =>
  execDockerCompose(new DockerCommandPs(containerName));
