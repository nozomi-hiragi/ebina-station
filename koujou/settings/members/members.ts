import { PROJECT_PATH } from "../settings.ts";
import { _TypeMember, Member } from "./member.ts";

const MEMBERS_FILE_PATH = `${PROJECT_PATH}/members.json`;

type TypeMembers = {
  members: { [id: string]: _TypeMember };
  temp?: { [id: string]: _TypeMember };
};

class Members {
  members: { [id: string]: Member | undefined } = {};
  temp: { [id: string]: Member | undefined } = {};
  preRquests: { [id: string]: { ip: string; token: string } | undefined } = {};

  constructor(value?: TypeMembers) {
    if (!value) return;
    Object.keys(value.members)
      .forEach((id) => this.members[id] = new Member(id, value.members[id]));
    if (value.temp) {
      const temp = value.temp;
      Object.keys(temp)
        .forEach((id) => this.temp[id] = new Member(id, temp[id]));
    }
  }

  getMember(id: string) {
    return this.members[id];
  }

  setMember(member: Member) {
    this.members[member.getId()] = member;
    this.saveMembersToFile();
  }

  addMember(member: Member) {
    if (this.members[member.getId()]) return false;
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
    this.saveMembersToFile();
    return true;
  }

  getMembersArray(ids: string[]) {
    const memberIds = Object.keys(this.members);
    return memberIds
      .filter((id) => ids.length !== 0 ? ids.includes(id) : true)
      .map((id) => ({ ...this.getMember(id), id, auth: undefined }));
  }

  saveMembersToFile() {
    const value: TypeMembers = { members: {} };
    Object.values(this.members).forEach((member) =>
      value.members[member!.getId()] = member!.getRawValue()
    );
    if (this.temp && Object.keys(this.temp).length !== 0) {
      value.temp = {};
      Object.values(this.temp).forEach((member) =>
        value.temp![member!.getId()] = member!.getRawValue()
      );
    }
    Deno.writeTextFileSync(
      MEMBERS_FILE_PATH,
      JSON.stringify(value, undefined, 2),
    );
  }

  hasMember = () => Object.keys(this.members).length !== 0;

  getTempMember(id: string) {
    return this.temp[id];
  }

  setTempMember(member: Member) {
    this.temp[member.getId()] = member;
    this.saveMembersToFile();
  }

  registTempMember(
    id: string,
    name: string,
    pass: string,
    admin?: boolean,
  ) {
    if (this.getMember(id)) return false;
    const member = Member.create(id, name, pass, admin);
    this.setTempMember(member);
    return member;
  }

  setPreRequest(id: string, ip: string, token: string) {
    this.preRquests[id] = { ip, token };
    // @TODO ログだしてもいいかも
  }

  popPreRequest(id: string) {
    const request = this.preRquests[id];
    if (request) delete this.preRquests[id];
    return request;
  }
}

const members: Members = (() => {
  try {
    return new Members(JSON.parse(Deno.readTextFileSync(MEMBERS_FILE_PATH)));
  } catch {
    return new Members();
  }
})();

export const getMembers = () => members;
