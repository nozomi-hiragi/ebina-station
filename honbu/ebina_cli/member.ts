import qrcode from "qrcode";
import { AuthManager } from "../auth_manager/mod.ts";
import { Command, CommandOption } from "../cli.ts";
import { Members } from "../project_data/members/mod.ts";
import { logConsole } from "../utils/log.ts";

export const createMemeberCommand = () =>
  new Command("member", (options) => {
    if (options.length < 2) {
      logConsole.info("not enough options");
      return;
    }
    if (options[0].option !== "temp") {
      logConsole.info("no temp");
      return;
    }
    const cmd = options[1];
    switch (cmd.option) {
      case "list": {
        const tempMembers = Members.instance().getTempMembers();
        const tempMemberArray = Object.keys(tempMembers)
          .map((id) => ({
            id,
            from: tempMembers[id]?.from,
            ...tempMembers[id]?.member.getValue(),
          }));
        logConsole.info(tempMemberArray);
        break;
      }
      case "regist": {
        const token = AuthManager.instance()
          .getRegistNewMemeberToken("console");
        if (!token) {
          logConsole.info("reached regist limit");
          break;
        }
        let frontURL = "https://nozomi-hiragi.github.io/ebina-station";
        let serverURL = ""; //
        let id = "";
        let name = "";

        options.forEach((option) => {
          if (option.option === "front") frontURL = option.value ?? "";
          else if (option.option === "server") serverURL = option.value ?? "";
          else if (option.option === "id") id = option.value ?? "";
          else if (option.option === "name") name = option.value ?? "";
        });

        if (frontURL) {
          try {
            const registURL = new URL(`${frontURL}/regist`);
            registURL.searchParams.append("t", token);
            if (serverURL) registURL.searchParams.append("s", serverURL);
            if (id) registURL.searchParams.append("i", id);
            if (name) registURL.searchParams.append("n", name);
            const registURLStr = registURL.toString();
            qrcode.generate(registURLStr, { small: true });
            logConsole.info(`URL: ${registURLStr}`);
          } catch (err) {
            if (err instanceof TypeError) logConsole.info("Invarid front URL");
            else logConsole.error("temp member regist error:", err);
          }
        }
        logConsole.info(`token: ${token}`);
        break;
      }
      case "admit":
        if (!cmd.value) logConsole.info("id is required");
        else {
          switch (cmd.value && Members.instance().admitTempMember(cmd.value)) {
            case true:
              logConsole.info("ok");
              break;
            case false:
              logConsole.info("this id is already used");
              break;
            case undefined:
            default:
              logConsole.info("wrong id");
              break;
          }
        }
        break;
      case "deny":
        if (!cmd.value) logConsole.info("id is required");
        else if (Members.instance().denyTempMember(cmd.value)) {
          logConsole.info("ok");
        } else {
          logConsole.info("wrong id");
        }
        break;
      default:
        logConsole.info("list, admit or deny");
        break;
    }
  }, {
    options: [
      new CommandOption("temp"),
      new CommandOption("list"),
      new CommandOption("regist"),
      new CommandOption("front", { takeValue: true }),
      new CommandOption("server", { takeValue: true }),
      new CommandOption("id", { takeValue: true }),
      new CommandOption("name", { takeValue: true }),
      new CommandOption("admit", { takeValue: true }),
      new CommandOption("deny", { takeValue: true }),
    ],
  });
