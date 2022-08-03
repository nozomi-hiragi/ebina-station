import { PROJECT_PATH } from "../../ebinaAPI/app/index.ts";
import { Member } from "./member.ts";
export type { WebAuthn, WebAuthnItem } from "./auth/webauthn.ts";

const MEMBERS_FILE_PATH = `${PROJECT_PATH}/members.json`;

class Members {
  members: { [key: string]: Member | undefined } = {};

  constructor(init?: Partial<Members>) {
    Object.assign(this, init);
  }

  saveMembersToFile() {
    Deno.writeTextFileSync(
      MEMBERS_FILE_PATH,
      JSON.stringify(members, undefined, 2),
    );
  }
}

const members: Members = (() => {
  try {
    return new Members(JSON.parse(Deno.readTextFileSync(MEMBERS_FILE_PATH)));
  } catch {
    return new Members();
  }
})();

export const getMembers = () => members.members;

export const getMember = (id: string) => members.members[id];

export const setMember = (id: string, member: Member) => {
  members.members[id] = member;
  members.saveMembersToFile();
};

export const updateMember = (
  id: string,
  callback: (member: Member) => Member,
) => {
  const member = members.members[id];
  if (!member) return false;
  const newMember = callback(member);
  members.members[id] = newMember;
  members.saveMembersToFile();
  return true;
};

export const addMember = (id: string, member: Member) => {
  if (members.members[id]) return false;
  members.members[id] = member;
  members.saveMembersToFile();
  return true;
};

export const removeMember = (id: string) => {
  if (!members.members[id]) return false;
  delete members.members[id];
  members.saveMembersToFile();
  return true;
};
