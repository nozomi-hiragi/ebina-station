import fs from 'fs'
import express, { NextFunction, Request, Response } from 'express'
import apiRouter from './api'
import jsRouter from './js'
import { mkdirIfNotExist } from '../../utils/utils'
import { authToken } from '../../utils/auth'
import { logApi } from "../../utils/log"

const FIRST_APP_NAME = 'FirstApp'
export const PROJECT_PATH = './project'
export const APPS_DIR = `${PROJECT_PATH}/apps`
export const GOMI_DIR = `${PROJECT_PATH}/gomi`

const appRouter = express.Router()

const getAppList = () => {
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

// アプリ名とる
// 400 ない
const pickupAppName = (req: Request, res: Response, next: NextFunction) => {
  if (!req.params.appName) return res.sendStatus(400)
  res.locals.appName = req.params.appName
  next()
}

// アプリ配列取得
// 200 名前ら
appRouter.get('/', authToken, (req, res) => res.status(200).json(getAppList()))

// アプリ作成
// 200 OK
// 400 情報足らない
appRouter.post('/:appName', authToken, pickupAppName, (req, res) => {
  const appName = res.locals.appName
  const appList = getAppList()
  const found = appList.find((name) => name.toLowerCase() === appName.toLowerCase())
  if (found) return res.status(400).json({ message: 'Already use this name' })

  mkdirIfNotExist(`${APPS_DIR}/${appName}`)

  res.sendStatus(200)
})

// アプリ取得 実質有無確認
// 200 あった
// 400 情報足らない
// 404 なかった
appRouter.get('/:appName', authToken, pickupAppName, (req, res) => {
  const appName = res.locals.appName
  const appList = getAppList()
  const found = appList.find((name) => name.toLowerCase() === appName.toLowerCase())
  res.sendStatus(found ? 200 : 404)
})

// アプリ削除 ゴミ箱に移動
// 200 OK
// 404 アプリない
// 500 フォルダ移動ミスった
appRouter.delete('/:appName', authToken, pickupAppName, (req, res) => {
  const appName = res.locals.appName
  const appList = getAppList()
  const found = appList.find((name) => name.toLowerCase() === appName.toLowerCase())
  if (!found) return res.sendStatus(404)

  mkdirIfNotExist(GOMI_DIR)

  try {
    fs.renameSync(`${APPS_DIR}/${appName}`, `${GOMI_DIR}/${appName}`)
    res.sendStatus(200)
  } catch (e) {
    logApi.error('delete', '/app', 'move folder failed', appName)
    res.sendStatus(500)
  }
})

appRouter.use('/:appName/api', pickupAppName, apiRouter)
appRouter.use('/:appName/js', pickupAppName, jsRouter)

export default appRouter
