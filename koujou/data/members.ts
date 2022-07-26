import { PROJECT_PATH } from "../ebinaAPI/app/index.ts";
import {
  AuthenticatorTransportFuture,
  PublicKeyCredentialType,
} from "../utils/webauthn.ts";

const MEMBERS_FILE_PATH = `${PROJECT_PATH}/members.json`;

export type User = {
  name: string;
  auth: {
    password?: AuthPassword;
    webAuthn?: WebAuthn;
  };
  flags?: Flags;
};

export type Members = {
  members: { [key: string]: User | undefined };
};

export type AuthPassword = {
  hash: string;
};

export type WebAuthn = {
  [origins: string]: WebAuthnItem | undefined;
};

export type FMT =
  | "fido-u2f"
  | "packed"
  | "android-safetynet"
  | "android-key"
  | "tpm"
  | "apple"
  | "none";

export type WebAuthnAuthenticator = {
  fmt: FMT;
  alg: { algName: string; hashAlg: string };
  counter: number; // necessary
  aaguid: string;
  credentialID: string; // necessary
  credentialPublicKey: string; // necessary
  credentialType: PublicKeyCredentialType;
  transports?: AuthenticatorTransportFuture[];
};

export type WebAuthnItem = {
  authenticators: { [key: string]: WebAuthnAuthenticator | undefined };
};

export type Flags = {
  admin?: boolean;
};

let members: Members;

const loadMembersFromFile = () => {
  members = JSON.parse(
    Deno.readTextFileSync(MEMBERS_FILE_PATH),
    (key, value) => {
      switch (key) {
        default:
          return value;
      }
    },
  ) as Members;
};

const saveMembersToFile = () => {
  Deno.writeTextFileSync(
    MEMBERS_FILE_PATH,
    JSON.stringify(members, (key, value) => {
      switch (key) {
        default:
          return value;
      }
    }, 2),
  );
};

loadMembersFromFile();

export const getMembers = () => members.members;

export const getMember = (id: string) => members.members[id];

export const setMember = (id: string, user: User) => {
  members.members[id] = user;
  saveMembersToFile();
};

export const updateMember = (id: string, callback: (user: User) => User) => {
  const user = members.members[id];
  if (!user) return false;
  const newUser = callback(user);
  members.members[id] = newUser;
  saveMembersToFile();
  return true;
};

export const addMember = (id: string, member: User) => {
  if (members.members[id]) return false;
  members.members[id] = member;
  saveMembersToFile();
  return true;
};

export const removeMember = (id: string) => {
  if (!members.members[id]) return false;
  delete members.members[id];
  saveMembersToFile();
  return true;
};
