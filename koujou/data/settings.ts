import fs from "fs"
import { PROJECT_PATH } from "../ebinaAPI/app"

const SETTINGS_FILE_PATH = `${PROJECT_PATH}/setting.json`

if (!fs.existsSync(SETTINGS_FILE_PATH)) {
  throw new Error('setting file is not exist')
}

export type WebAuthnSetting = {
  rpName: string,
  rpIDType: 'variable' | 'static',
  rpID?: string,
  attestationType?: 'direct' | 'enterprise' | 'indirect' | 'none',
}

type Settings = {
  port?: 'env' | number,
  membersEncryption: boolean,
  origins: string[] | string,
  WebAuthn?: WebAuthnSetting,
  getPort: () => number,
}

const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8')) as Settings

settings.getPort = () => {
  let port: number | undefined
  if (typeof settings.port === 'string') {
    port = settings.port === 'env' ? Number(process.env.PORT) : undefined
  } else {
    port = settings.port
  }
  return port || 3456
}

export const getSettings = () => settings
