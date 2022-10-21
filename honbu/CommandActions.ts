export class MemberTempActions {
  honbuKey: string;
  koujouPort: number;

  constructor(honbuKey: string, koujouPort: number) {
    this.honbuKey = honbuKey;
    this.koujouPort = koujouPort;
  }

  showTempMemberList = () =>
    fetch(`http://${"localhost"}:${this.koujouPort}/honbu/member/temp/list`, {
      method: "GET",
      headers: { key: this.honbuKey },
    }).then((ret) => ret.json())
      .then((ret) => console.log(ret));

  admitTempMember = (id: string) =>
    fetch(
      `http://${"localhost"}:${this.koujouPort}/honbu/member/temp/admit`,
      {
        method: "POST",
        body: JSON.stringify({ id }),
        headers: { key: this.honbuKey },
      },
    ).then((ret) => {
      switch (ret.status) {
        case 200:
          console.log("ok");
          break;
        case 400:
        case 404:
        default:
          console.log("wrong id");
          break;
        case 409:
          console.log("this id is already used");
          break;
      }
    });

  denyTempMember = (id: string) =>
    fetch(`http://${"localhost"}:${this.koujouPort}/honbu/member/temp/deny`, {
      method: "POST",
      body: JSON.stringify({ id }),
      headers: { key: this.honbuKey },
    }).then((ret) => {
      switch (ret.status) {
        case 200:
          console.log("ok");
          break;
        case 400:
        case 404:
        default:
          console.log("wrong id");
          break;
      }
    });

  actionst: { [name: string]: (id: string) => Promise<void> } = {
    "list": async () => await this.showTempMemberList(),
    "admit": async (id: string) => {
      if (id) await this.admitTempMember(id);
      else console.log("id is required");
    },
    "deny": async (id: string) => {
      if (id) await this.denyTempMember(id);
      else console.log("id is required");
    },
  };
}
