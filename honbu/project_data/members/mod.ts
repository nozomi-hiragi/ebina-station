import { MEMBERS_FILE_PATH } from "../mod.ts";
import { Member, MemberValues } from "./member.ts";

interface MembersValues {
  members: { [id: string]: MemberValues };
  temp?: { [id: string]: { from: string; member: MemberValues } };
}

const EXPIRE_TIME_MS = 30 * 60 * 1000;
const checkExpire = (date: Date) => {
  return (date.getTime() + EXPIRE_TIME_MS) < Date.now();
};

export class Members {
  private static _instance: Members;
  static instance() {
    if (!this._instance) this._instance = new Members();
    return this._instance;
  }
  private constructor() {}

  members: { [id: string]: Member | undefined } = {};
  temp: { [id: string]: { from: string; member: Member } | undefined } = {};
  preRquests: { [token: string]: { from: string; date: Date } | undefined } =
    {};

  load() {
    try {
      const value: MembersValues = JSON.parse(
        Deno.readTextFileSync(MEMBERS_FILE_PATH),
      );
      Object.keys(value.members)
        .forEach((id) => this.members[id] = new Member(id, value.members[id]));
      if (value.temp) {
        const temp = value.temp;
        Object.keys(temp).forEach((id) =>
          this.temp[id] = {
            from: temp[id].from,
            member: new Member(id, temp[id].member),
          }
        );
      }
    } catch {
      return false;
    }
  }

  save() {
    try {
      const value: MembersValues = { members: {} };
      Object.values(this.members).forEach((member) =>
        value.members[member!.getId()] = member!.getRawValue()
      );
      if (this.temp && Object.keys(this.temp).length !== 0) {
        value.temp = {};
        Object.values(this.temp).forEach((member) =>
          value.temp![member!.member.getId()] = {
            from: member!.from,
            member: member!.member.getRawValue(),
          }
        );
      }
      Deno.writeTextFileSync(
        MEMBERS_FILE_PATH,
        JSON.stringify(value, undefined, 2),
      );
      return true;
    } catch (err) {
      console.log(err);
      return false;
    }
  }

  getMember(id: string) {
    return this.members[id];
  }

  setMember(member: Member) {
    this.members[member.getId()] = member;
    this.save();
  }

  addMember(member: Member) {
    if (this.getMember(member.getId())) return false;
    this.setMember(member);
    return true;
  }

  registMember(
    id: string,
    name: string,
    pass: string,
    admin?: boolean,
  ) {
    if (this.getMember(id)) return false;
    const member = Member.create(id, name, pass, admin);
    return this.addMember(member);
  }

  removeMember(id: string) {
    if (!this.getMember(id)) return false;
    delete this.members[id];
    this.save();
    return true;
  }

  getMembersArray(ids: string[]) {
    const memberIds = Object.keys(this.members);
    return memberIds
      .filter((id) => ids.length !== 0 ? ids.includes(id) : true)
      .map((id) => ({ ...this.getMember(id), id, auth: undefined }));
  }

  memberCount = () => Object.keys(this.members).length;
  tempMemberCount = () => Object.keys(this.temp).length;
  allMemberCount = () => this.memberCount() + this.tempMemberCount();

  hasMember = () => this.memberCount() !== 0;

  getTempMember(id: string) {
    return this.temp[id];
  }

  getTempMembers() {
    return this.temp;
  }

  setTempMember(from: string, member: Member) {
    this.temp[member.getId()] = { from, member };
    this.save();
  }

  addTempMember(from: string, member: Member) {
    if (this.temp[member.getId()]) return false;
    this.setTempMember(from, member);
    return true;
  }

  registTempMember(
    from: string,
    id: string,
    name: string,
    pass: string,
    admin?: boolean,
  ) {
    if (this.getMember(id)) return undefined;
    const member = Member.create(id, name, pass, admin);
    return this.addTempMember(from, member) ? member : undefined;
  }

  admitTempMember(id: string) {
    const temp = this.getTempMember(id);
    if (!temp) return undefined;
    if (this.getMember(id)) return false;
    delete this.temp[id];
    this.setMember(temp.member);
    return true;
  }

  denyTempMember(id: string) {
    const temp = this.getTempMember(id);
    if (!temp) return undefined;
    delete this.temp[id];
    this.save();
    return true;
  }

  setPreRequest(token: string, from: string) {
    this.preRquests[token] = { from, date: new Date() };
    const keys = Object.keys(this.preRquests);
    for (const key of keys) {
      const value = this.preRquests[key]!;
      if (checkExpire(value.date)) delete this.preRquests[key];
    }
    // @TODO ログだしてもいいかも
  }

  popPreRequest(token: string) {
    const request = this.preRquests[token];
    if (request) {
      delete this.preRquests[token];
      if (checkExpire(request.date)) return null;
    }
    return request;
  }
}
