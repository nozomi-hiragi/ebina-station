import { Command, CommandOption } from "../cli.ts";
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
          .map((id) => ({ id, ...tempMembers[id]?.getValue() }));
        console.log(tempMemberArray);
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
      new CommandOption("admit", { takeValue: true }),
      new CommandOption("deny", { takeValue: true }),
    ],
  });
