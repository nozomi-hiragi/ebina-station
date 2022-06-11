import fs from 'fs'
import express from 'express'
import apiRouter from './api'
import editRouter from './edit'
import { mkdirIfNotExist } from '../../utils/utils'
import { authToken } from '../../utils/auth'
import { logApi } from "../../utils/log"

const FIRST_APP_NAME = 'FirstApp'
export const PROJECT_PATH = './project'
export const APPS_DIR = `${PROJECT_PATH}/apps`
export const GOMI_DIR = `${PROJECT_PATH}/gomi`

export const getAppList = () => {
  const appList = fs.readdirSync(APPS_DIR)
    .filter((name) =>
      fs.statSync(`${APPS_DIR}/${name}`)
        .isDirectory())
  if (appList.length === 0) {
    mkdirIfNotExist(`${APPS_DIR}/${FIRST_APP_NAME}`)
    appList.push(FIRST_APP_NAME)
  }
  return appList
}

const app = express.Router()

app.post('/:appName', authToken, (req, res) => {
  const appName = req.params.appName
  console.log(appName)
  const appList = getAppList()
  const found = appList.find((name) => name.toLowerCase() === appName.toLowerCase())
  if (found) return res.sendStatus(400)

  mkdirIfNotExist(`${APPS_DIR}/${appName}`)

  res.sendStatus(200)
})

app.get('/:appName', authToken, (req, res) => {
  const appName = req.params.appName
  const appList = getAppList()
  const found = appList.find((name) => name.toLowerCase() === appName.toLowerCase())
  res.sendStatus(found ? 200 : 404)
})

app.delete('/:appName', authToken, (req, res) => {
  const appName = req.params.appName
  const appList = getAppList()
  const found = appList.find((name) => name.toLowerCase() === appName.toLowerCase())
  if (!found) return res.sendStatus(400)

  mkdirIfNotExist(GOMI_DIR)

  try {
    fs.renameSync(`${APPS_DIR}/${appName}`, `${GOMI_DIR}/${appName}`)
    res.sendStatus(200)
  } catch (e) {
    logApi.error('delete', '/app', 'move folder failed', appName)
    res.sendStatus(500)
  }
})

app.use('/:appName/api', (req, res, next) => {
  if (!req.params.appName) return res.sendStatus(400)
  res.locals.appName = req.params.appName
  next()
}, apiRouter)

app.use('/:appName/edit', (req, res, next) => {
  if (!req.params.appName) return res.sendStatus(400)
  res.locals.appName = req.params.appName
  next()
}, editRouter)

export default app
