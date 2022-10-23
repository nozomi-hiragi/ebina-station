export class KoujouAPI {
  honbuURL: string;
  headers: { key: string };

  constructor(honbuKey: string, koujouPort: number) {
    this.honbuURL = `http://localhost:${koujouPort}/honbu`;
    this.headers = { key: honbuKey };
  }

  getTempMemberList = () =>
    fetch(`${this.honbuURL}/member/temp/list`, {
      headers: this.headers,
      method: "GET",
    }).then((ret) => ret.json());

  admitTempMember = (id: string) =>
    fetch(`${this.honbuURL}/member/temp/admit`, {
      headers: this.headers,
      method: "POST",
      body: JSON.stringify({ id }),
    }).then((ret) => ret.status);

  denyTempMember = (id: string) =>
    fetch(`${this.honbuURL}/member/temp/deny`, {
      headers: this.headers,
      method: "POST",
      body: JSON.stringify({ id }),
    }).then((ret) => ret.status);

  addRoute = (
    route: { name: string; hostname: string; port: number | "koujou" },
  ) =>
    fetch(`${this.honbuURL}/route`, {
      headers: this.headers,
      method: "POST",
      body: JSON.stringify(route),
    }).then((ret) => ret.status);
}
