import fs from 'fs'
import express from 'express'
import apiRouter from './api'
import editRouter from './edit'
import { mkdirIfNotExist } from '../../utils/utils'

const FIRST_APP_NAME = 'FirstApp'
export const PROJECT_PATH = './project'

export const getAppList = () => {
  const appList = fs.readdirSync(PROJECT_PATH)
    .filter((name) =>
      fs.statSync(`${PROJECT_PATH}/${name}`)
        .isDirectory())
  if (appList.length === 0) {
    mkdirIfNotExist(`${PROJECT_PATH}/${FIRST_APP_NAME}`)
    appList.push(FIRST_APP_NAME)
  }
  return appList
}
const app = express.Router()

app.use('/api', apiRouter)
app.use('/edit', editRouter)

export default app
