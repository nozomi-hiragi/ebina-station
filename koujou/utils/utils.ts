import fs from 'fs'

export const mkdirIfNotExist = (path: string) =>
  fs.existsSync(path) ? undefined : fs.mkdirSync(path, { recursive: true })
