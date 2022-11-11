import { ReaderBuffer } from "./utils/utils.ts";

const readReader = async (
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

export class CommandOption {
  option: string;
  takeValue: boolean;
  alias: string[];
  constructor(option: string, ex?: { takeValue?: boolean; alias?: string[] }) {
    this.option = option;
    this.takeValue = ex?.takeValue ?? false;
    this.alias = ex?.alias ?? [];
  }

  check(target: string) {
    return target === this.option || this.alias.includes(target);
  }
}

export interface OptionValue {
  option: string;
  value?: string;
}
export type OnExecute = (options: OptionValue[], command: string[]) => void;

export class Command {
  command: string;
  onExecute: OnExecute;
  onInteract?: (str: string) => boolean;
  options: CommandOption[];

  constructor(
    command: string,
    onExecute: OnExecute,
    ex?: {
      onInteract?: (str: string) => boolean;
      options?: CommandOption[];
    },
  ) {
    this.command = command;
    this.onExecute = onExecute;
    this.onInteract = ex?.onInteract;
    this.options = ex?.options ?? [];
  }

  addOption(...options: CommandOption[]) {
    this.options.push(...options);
  }

  execute(command: string[]) {
    if (command[0] !== this.command) return;
    const cmdLen = command.length;
    const options: OptionValue[] = [];
    if (cmdLen > 1) {
      for (let i = 1; i < cmdLen; i++) {
        const op = this.options.find((op) => op.check(command[i]));
        if (!op) continue;
        options.push({
          option: op.option,
          value: op.takeValue ? command[++i] : undefined,
        });
      }
    }
    this.onExecute(options, command);
  }
}

export class CLI {
  exitCommand: Command;
  commands: { [name: string]: Command | undefined } = {};

  constructor(exitCommand: Command, commands: Command[] = []) {
    this.exitCommand = exitCommand;
    for (const it of commands) this.addCommand(it);
  }

  addCommand(command: Command) {
    this.commands[command.command] = command;
  }

  start() {
    let interact: Command | undefined;
    return readReader(Deno.stdin, (msg: string) => {
      if (interact) {
        if (!interact.onInteract || interact.onInteract(msg)) {
          interact = undefined;
        }
      } else {
        const input = msg.split(" ");
        const command = this.commands[input[0]];
        if (command) {
          command.execute(input);
          if (command.onInteract !== undefined) interact = command;
        } else if (this.exitCommand.command === input[0]) {
          this.exitCommand.execute(input);
          return true;
        } else {
          console.log("><");
        }
      }
    });
  }
}
