import fs from 'fs'

const MEMBERS_FILE_PATH = './project/members.json'

export type User = {
  id: string,
  name: string,
  auth: { password?: AuthPassword },
  flags?: Flags,
}

export type Members = {
  members: { [key: string]: (User | undefined) }
}

export type AuthPassword = {
  hash: string
}

export type Flags = {
  admin?: boolean
}

let members: Members

const loadMembersFromFile = () => {
  members = JSON.parse(fs.readFileSync(MEMBERS_FILE_PATH, 'utf8')) as Members
}

const saveMembersToFile = () => {
  fs.writeFileSync(MEMBERS_FILE_PATH, JSON.stringify(members))
}

loadMembersFromFile()

export const getMembers = () => members.members

export const getMember = (id: string) => members.members[id]

export const addMember = (id: string, member: User) => {
  if (members.members[id]) return false
  members.members[id] = member
  saveMembersToFile()
  return true
}

export const removeMember = (id: string) => {
  if (!members.members[id]) return false
  delete members.members[id]
  saveMembersToFile()
  return true
}