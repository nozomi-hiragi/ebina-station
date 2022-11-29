import { isString } from "../deps.ts";
import { runCommand } from "../utils/utils.ts";

export const execDCCRun = (
  containerName: string,
  command: string | string[],
  remove = true,
) => {
  const cmd = ["docker-compose"];
  if (containerName === "") throw new Error("no container name");
  cmd.push("run");
  if (remove) cmd.push("--rm");
  cmd.push(containerName);
  cmd.push(...(isString(command) ? command.split(" ") : command));
  return runCommand(cmd);
};

export const execDCCUp = (containerName: string, detach = true) => {
  const cmd = ["docker-compose"];
  if (containerName === "") throw new Error("no container name");
  cmd.push("up");
  if (detach) cmd.push("-d");
  cmd.push(containerName);
  return runCommand(cmd);
};

export const execDCCRm = (
  containerName: string,
  forceRemove = true,
  beforeStop = true,
) => {
  const cmd = ["docker-compose"];
  if (containerName === "") throw new Error("no container name");
  cmd.push("rm");
  if (forceRemove) cmd.push("-f");
  if (beforeStop) cmd.push("-s");
  cmd.push(containerName);
  return runCommand(cmd);
};

export const execDCCRestart = (containerName: string, timeout?: number) => {
  const cmd = ["docker-compose"];
  if (containerName === "") throw new Error("no container name");
  cmd.push("restart");
  if (timeout) {
    cmd.push("-t");
    cmd.push(`${timeout}`);
  }
  cmd.push(containerName);
  return runCommand(cmd);
};

export const execDCCPs = (containerName: string, quiet?: boolean) => {
  const cmd = ["docker-compose"];
  if (containerName === "") throw new Error("no container name");
  cmd.push("ps");
  if (quiet) cmd.push("-q");
  cmd.push(containerName);
  return runCommand(cmd);
};
