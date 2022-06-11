import fs from 'fs'
import { APPS_DIR } from '../ebinaAPI/App'

export type APIType = {
  path: string,
  type: "string" | "JavaScript",
  value: string,
}

export type APIsType = {
  port: number,
  apis: { [key: string]: (APIType | undefined) }
}

export class APIs {
  private jsonPath: string
  private apis: APIsType

  constructor(appName: string) {
    this.jsonPath = `${APPS_DIR}/${appName}/apis.json`
    if (fs.existsSync(this.jsonPath)) {
      this.apis = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8'))
    } else {
      this.apis = { apis: {}, port: 1234 }
      this.saveAPIsToFile()
    }
  }

  private saveAPIsToFile() {
    if (!this.jsonPath) return
    fs.writeFileSync(this.jsonPath, JSON.stringify(this.apis, undefined, 2))
  }

  public getAPIs() {
    return this.apis.apis
  }

  public getAPI(name: string) {
    return this.apis.apis[name]
  }

  public setAPI(name: string, api: APIType) {
    this.apis.apis[name] = api
    this.saveAPIsToFile()
  }

  public deleteAPI(name: string) {
    if (!this.apis.apis[name]) return false
    delete this.apis.apis[name]
    this.saveAPIsToFile()
    return true
  }

  public getPort() {
    return this.apis.port
  }
}
