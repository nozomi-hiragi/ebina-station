import fs from 'fs'

const APIS_FILE_PATH = './project/apis.json'

export type API = {
  path: string,
  type: "string" | "JavaScript",
  value: string,
}

export type APIs = {
  apis: { [key: string]: (API | undefined) }
}

let apis: APIs

const loadAPIsFromFile = () => {
  apis = JSON.parse(fs.readFileSync(APIS_FILE_PATH, 'utf8'))
}

const saveAPIsToFile = () => {
  fs.writeFileSync(APIS_FILE_PATH, JSON.stringify(apis, undefined, 2))
}

loadAPIsFromFile()

export const getAPIs = () => apis.apis as { [key: string]: (API) }

export const getAPI = (name: string) => apis.apis[name]

export const setAPI = (name: string, api: API) => {
  apis.apis[name] = api
  saveAPIsToFile()
}

export const deleteAPI = (name: string) => {
  if (!apis.apis[name]) return false
  delete apis.apis[name]
  saveAPIsToFile()
  return true
}
