import fs from 'fs'
import base64url from 'base64url'

const MEMBERS_FILE_PATH = './project/members.json'

export type User = {
  name: string,
  auth: {
    password?: AuthPassword,
    webAuthn?: WebAuthn,
  },
  flags?: Flags,
}

export type Members = {
  members: { [key: string]: (User | undefined) }
}

export type AuthPassword = {
  hash: string
}

export type WebAuthn = {
  [origins: string]: WebAuthnItem | undefined
}

export type WebAuthnAuthenticator = {
  fmt: 'fido-u2f' | 'packed' | 'android-safetynet' | 'android-key' | 'tpm' | 'apple' | 'none',
  counter: number, // necessary
  aaguid: string,
  credentialID: Buffer, // necessary
  credentialPublicKey: Buffer, // necessary
  credentialType: 'public-key',
  attestationObject: Buffer,
  userVerified: boolean,
  credentialDeviceType: 'singleDevice' | 'multiDevice',
  credentialBackedUp: boolean,
  transports?: ('ble' | 'internal' | 'nfc' | 'usb' | 'cable')[],
}

export type WebAuthnItem = {
  authenticators: { [key: string]: WebAuthnAuthenticator | undefined }
}

export type Flags = {
  admin?: boolean
}

let members: Members

const loadMembersFromFile = () => {
  members = JSON.parse(fs.readFileSync(MEMBERS_FILE_PATH, 'utf8'), (key, value) => {
    switch (key) {
      case 'credentialID':
      case 'credentialPublicKey':
      case 'attestationObject':
        return base64url.toBuffer(value)
      default:
        return value
    }
  }) as Members
}

const saveMembersToFile = () => {
  fs.writeFileSync(MEMBERS_FILE_PATH, JSON.stringify(members, (key, value) => {
    switch (key) {
      case 'credentialID':
      case 'credentialPublicKey':
      case 'attestationObject':
        if (value.type !== 'Buffer') return value
        return base64url.encode(value.data)
      default:
        return value
    }
  }, 2))
}

loadMembersFromFile()

export const getMembers = () => members.members

export const getMember = (id: string) => members.members[id]

export const setMember = (id: string, user: User) => {
  members.members[id] = user
  saveMembersToFile()
}

export const updateMember = (id: string, callback: (user: User) => User) => {
  const user = members.members[id]
  if (!user) return false
  const newUser = callback(user)
  members.members[id] = newUser
  saveMembersToFile()
  return true
}

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