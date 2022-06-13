import express from "express"
import fs from 'fs'
import { APPS_DIR } from "."
import { authToken } from "../../utils/auth"
import { logApi } from "../../utils/log"
import { mkdirIfNotExist } from "../../utils/utils"

const jsRouter = express.Router()

const initFolder = (appName: string) => {
  mkdirIfNotExist(`${APPS_DIR}/${appName}/js`)
}

// JSファイル一覧取得
// 200 一覧
// 500 ファイル読めなかった
jsRouter.get('/', authToken, (req, res) => {
  const appName = res.locals.appName

  try {
    initFolder(appName)
    const baseDir = `${APPS_DIR}/${appName}/js`

    const files: string[] = []
    const exploringDir = (dirPath: string) => {
      const names = fs.readdirSync(`${baseDir}/${dirPath}`)
      names.forEach((name) => {
        const relativePath = `${dirPath}/${name}`
        if (fs.statSync(`${baseDir}/${relativePath}`).isDirectory()) {
          exploringDir(`${relativePath}/`)
        } else {
          files.push(relativePath.substring(1))
        }
      })
    }
    exploringDir('')

    res.status(200).json(files)
  } catch (err) {
    logApi.error('get', 'api/js', err)
    res.sendStatus(500)
  }
})

// JSファイル作成
// :path
// {}: string?
// 200 OK
// 400 情報おかしい
// 409 もうある
// 500 ファイル関係ミスった
jsRouter.post('/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  const { path } = req.params
  if (!path) return res.sendStatus(400)

  try {
    initFolder(appName)
    const fullPath = `${APPS_DIR}/${appName}/js/${path}`
    if (fs.existsSync(fullPath)) return res.sendStatus(409)
    const body = req.body
    const isString = typeof body === 'string'
    fs.writeFileSync(fullPath, isString ? body : '')
    res.sendStatus(200)
  } catch (err) {
    logApi.error('post', 'api/js/:paht', err)
    res.sendStatus(500)
  }
})

// JSファイル取得
// :path
// 200 text
// 400 情報おかしい
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.get('/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  const { path } = req.params
  if (!path) return res.sendStatus(400)

  try {
    initFolder(appName)
    const fullPath = `${APPS_DIR}/${appName}/js/${path}`
    if (!fs.existsSync(fullPath)) return res.sendStatus(404)
    if (fs.statSync(fullPath).isDirectory()) {
      const dir = fs.readdirSync(fullPath)
      res.status(409).json(dir)
    } else {
      const text = fs.readFileSync(fullPath)
      res.status(200).send(text)
    }
  } catch (err) {
    logApi.error('get', 'api/js/:path', err)
    res.send(500)
  }
})

// JSファイル更新
// :path
// 200 OK
// 400 情報おかしい
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.patch('/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  const { path } = req.params
  if (!path) return res.sendStatus(400)

  try {
    initFolder(appName)
    const fullPath = `${APPS_DIR}/${appName}/js/${path}`
    if (!fs.existsSync(fullPath)) return res.sendStatus(404)
    if (fs.statSync(fullPath).isDirectory()) return res.sendStatus(409)

    const body = req.body
    const isString = typeof body === 'string'
    if (!isString) return res.sendStatus(400)
    fs.writeFileSync(fullPath, body)
    res.sendStatus(200)
  } catch (err) {
    logApi.error('patch', 'api/js/:path', err)
    res.send(500)
  }
})

// JSファイル削除
// :path
// 200 OK
// 404 ファイルない
// 409 ディレクトリ
// 500 ファイル関係ミスった
jsRouter.delete('/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  const { path } = req.params
  if (!path) return res.sendStatus(400)

  try {
    initFolder(appName)
    const fullPath = `${APPS_DIR}/${appName}/js/${path}`
    if (!fs.existsSync(fullPath)) return res.sendStatus(404)
    if (fs.statSync(fullPath).isDirectory()) return res.sendStatus(409)

    fs.unlinkSync(fullPath)
    res.sendStatus(200)
  } catch (err) {
    logApi.error('delete', 'api/js/:path', err)
    res.send(500)
  }
})

export default jsRouter
