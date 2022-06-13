import express from "express"
import child_process, { SendHandle, Serializable } from "child_process"
import fs from 'fs'
import { authToken } from "../../utils/auth"
import { APIs } from '../../data/apis'
import { APPS_DIR } from "."

const apiRouter = express.Router()

const entrances: {
  [name: string]: {
    entranceProc: child_process.ChildProcess | null,
    startedDate: number | null
  } | undefined
} = {}

process.on('exit', () =>
  Object.values(entrances).forEach((entrance) =>
    entrance?.entranceProc?.kill('SIGINT')
  )
)

const apisList: { [name: string]: APIs | undefined } = {}

// API起動状態取得
// 200 { status: 'started' | 'stop', started_at: number }
apiRouter.get('/status', authToken, (req, res) => {
  const appName = res.locals.appName
  const entrance = entrances[appName]
  const isStarted = entrance && entrance.entranceProc
  res.status(200).json({
    status: isStarted ? 'started' : 'stop',
    started_at: isStarted ? entrance.startedDate : undefined,
  })
})

// API起動状態更新
// { status: 'start' | 'stop' }
// 200 できた
// 400 情報おかしい
// 500 起動できなかった
apiRouter.put('/status', authToken, (req, res) => {
  const appName = res.locals.appName
  const { status } = req.body
  if (!status) return res.sendStatus(400)
  const isStop = status === 'stop'

  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))
  const entrance = entrances[appName]

  if (entrance && entrance.entranceProc) {
    entrance.entranceProc.kill('SIGINT')
    entrance.entranceProc = null
    entrance.startedDate = null
    if (isStop) return res.status(200).json({ message: 'stop' })
  }
  else if (isStop) return res.status(200).json({ message: 'already stoped' })

  switch (status) {
    case 'start':
      const files: string[] = []
      let importStr = 'module.exports = {'
      const apis = apisInstance.getAPIs()
      const apiList = Object.keys(apis).map((key) => {
        const value = apis[key]!
        switch (value.type) {
          case 'JavaScript':
            const arg = value.value.split('>')
            const filename = arg[0]
            if (!files.includes(filename)) {
              files.push(arg[0])
              importStr += `"${filename}": require("${APPS_DIR}/${appName}/js/${filename}"),`
            }
        }
        return { ...value, path: key }
      })
      importStr += `}`

      fs.writeFileSync('imports.js', importStr)

      const entranceProc = child_process.fork('./entrance')
      const startedDate = Date.now()
      const entranceEventListener = (message: Serializable, sendHandle: SendHandle) => {
        switch (message) {
          case 'start':
            res.status(200).json({ message: 'start' })
            break

          case 'exit':
            const entrance = entrances[appName]
            if (!entrance) return
            entrance.entranceProc = null
            entrance.startedDate = null
            res.sendStatus(500)
            break
        }
        entranceProc.removeListener('message', entranceEventListener)
      }
      entranceProc.on('message', entranceEventListener)
      const message = {
        command: 'start',
        port: apisInstance.getPort(),
        routs: apiList
      }
      entranceProc.send(message)
      entrances[appName] = { entranceProc, startedDate }
      break;

    default:
      res.sendStatus(400)
      break;
  }
})

// ポート取得
// 200 { port: number }
apiRouter.get('/port', authToken, (req, res) => {
  const appName = res.locals.appName
  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))
  res.status(200).json({ port: apisInstance.getPort() })
})

// ポート設定
// { port: number }
// 200 OK
// 400 情報おかしい
apiRouter.put('/port', authToken, (req, res) => {
  const appName = res.locals.appName
  const { port } = req.body
  if (!port) { return res.sendStatus(400) }

  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))
  apisInstance.setPort(port)
  res.sendStatus(200)
})

// API一覧取得
// 200 { path, api }
apiRouter.get('/endpoint', authToken, (req, res) => {
  const appName = res.locals.appName
  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))

  const apis = apisInstance.getAPIs()
  const apiList = Object.keys(apis).map((path) => ({ path, api: apis[path] }))
  res.status(200).json(apiList)
})

// API作成
// :path
// { name, method, type, value }
// 200 OK
// 400 情報おかしい
apiRouter.post('/endpoint/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  const { path } = req.params
  const { name, method, type, value } = req.body
  if (!path || !name || !method || !type || !value) return res.sendStatus(400)

  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))
  apisInstance.setAPI(path, { name, method, type, value })
  res.sendStatus(200)
})

// API取得
// :path
// 200 API
// 400 情報おかしい
// 404 ない
apiRouter.get('/endpoint/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  const { path } = req.params
  if (!path) return res.sendStatus(400)

  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))
  const api = apisInstance.getAPI(path)
  if (api) {
    res.status(200).json(api)
  } else {
    res.sendStatus(404)
  }
})

// API更新
// :path
// 200 OK
// 400 情報おかしい
apiRouter.put('/endpoint/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  const { path } = req.params
  const { name, method, type, value } = req.body
  if (!path || !name || !method || !type || !value) return res.sendStatus(400)

  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))
  apisInstance.setAPI(path, { name, method, type, value })
  res.sendStatus(200)
})

// API削除
// 200 OK
// 400 情報おかしい
// 404 パスない
apiRouter.delete('/endpoint/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  const { path } = req.params
  if (!path) return res.sendStatus(400)

  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))
  res.sendStatus(apisInstance.deleteAPI(path) ? 200 : 404)
})

export default apiRouter
