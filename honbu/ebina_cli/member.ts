import { AuthManager } from "../auth_manager/mod.ts";
import { Command, CommandOption } from "../cli.ts";
import { qrcode } from "../deps.ts";
import { Members } from "../project_data/members/mod.ts";

export const createMemeberCommand = () =>
  new Command("member", (options) => {
    if (options.length < 2) {
      console.log("not enough options");
      return;
    }
    if (options[0].option !== "temp") {
      console.log("no temp");
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
        console.log(tempMemberArray);
        break;
      }
      case "regist": {
        const token = AuthManager.instance()
          .getRegistNewMemeberToken("console");
        if (!token) {
          console.log("reached regist limit");
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
            console.log(`URL: ${registURLStr}`);
          } catch (err) {
            if (err instanceof TypeError) console.log("Invarid front URL");
            else console.log(err);
          }
        }
        console.log(`token: ${token}`);
        break;
      }
      case "admit":
        if (!cmd.value) console.log("id is required");
        else {
          switch (cmd.value && Members.instance().admitTempMember(cmd.value)) {
            case true:
              console.log("ok");
              break;
            case false:
              console.log("this id is already used");
              break;
            case undefined:
            default:
              console.log("wrong id");
              break;
          }
        }
        break;
      case "deny":
        if (!cmd.value) console.log("id is required");
        else if (Members.instance().denyTempMember(cmd.value)) {
          console.log("ok");
        } else {
          console.log("wrong id");
        }
        break;
      default:
        console.log("list, admit or deny");
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
