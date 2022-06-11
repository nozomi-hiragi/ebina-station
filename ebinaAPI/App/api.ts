import express from "express"
import child_process, { SendHandle, Serializable } from "child_process"
import { authToken } from "../../utils/auth"
import { APIs } from '../../data/apis'
import fs from 'fs'
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

type ApiStatus = {
  status: string,
}

const apisList: { [name: string]: APIs | undefined } = {}

apiRouter.get('/status', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  const entrance = entrances[appName]
  const isStarted = entrance && entrance.entranceProc
  res.status(200).json({
    status: isStarted ? 'started' : 'stop',
    started_at: isStarted ? entrance.startedDate : undefined,
  } as ApiStatus)
})

apiRouter.post('/start', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))
  const entrance = entrances[appName]

  if (entrance && entrance.entranceProc) {
    entrance.entranceProc.kill('SIGINT')
    entrance.entranceProc = null
    entrance.startedDate = null
  }

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
    return { ...value, name: key }
  })
  importStr += `}`

  fs.writeFileSync('imports.js', importStr)

  const entranceProc = child_process.fork('./entrance')
  const startedDate = Date.now()
  const callback = (message: Serializable, sendHandle: SendHandle) => {
    switch (message) {
      case 'start':
        res.status(200).json("ok")
        break

      case 'exit':
        const entrance = entrances[appName]
        if (!entrance) return
        entrance.entranceProc = null
        entrance.startedDate = null
        res.sendStatus(500)
        break
    }
    entranceProc.removeListener('message', callback)
  }
  entranceProc.on('message', callback)
  const message = {
    command: 'start',
    port: apisInstance.getPort(),
    routs: apiList
  }
  entranceProc.send(message)
  entrances[appName] = { entranceProc, startedDate }
})

apiRouter.post('/stop', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  const entrance = entrances[appName]
  if (entrance && entrance.entranceProc) {
    entrance.entranceProc.kill('SIGINT')
    entrance.entranceProc = null
    entrance.startedDate = null
    res.status(200).json('stop')
  } else {
    res.status(200).json('already stoped')
  }
})

apiRouter.get('/apis', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))

  const apis = apisInstance.getAPIs()
  const apiList = Object.keys(apis).map((key) => {
    const api = apis[key]
    return { ...api, name: key }
  })
  res.status(200).json(apiList)
})

apiRouter.get('/api', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))

  const name = (req.query.name as string)
  if (!name) { return res.sendStatus(400) }
  const api = apisInstance.getAPI(name)
  if (api) {
    res.status(200).json({ ...api, name })
  } else {
    res.sendStatus(400)
  }
})

apiRouter.post('/path', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))

  const { path, name, type, value } = req.body
  if (!path || !name || !type || !value) { return res.sendStatus(400) }
  apisInstance.setAPI(name, { path, type, value })
  res.sendStatus(200)
})

apiRouter.put('/path', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))

  const { path, name, type, value } = req.body
  if (!path || !name || !type || !value) { return res.sendStatus(400) }
  apisInstance.setAPI(name, { path, type, value })
  res.sendStatus(200)
})

apiRouter.delete('/path', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  let apisInstance = apisList[appName] ?? (apisList[appName] = new APIs(appName))

  const name = req.query.name as string
  if (!name) { return res.sendStatus(400) }
  apisInstance.deleteAPI(name)
  res.sendStatus(202)
})

export default apiRouter
