import express from "express"
import child_process from "child_process"
import { authToken } from "../utils/auth"
import { deleteAPI, getAPI, getAPIs, setAPI } from '../utils/apis'
import fs from 'fs'

const BASE_PATH_FILE = './project/js/'

const apiRouter = express.Router()
let entranceProc: child_process.ChildProcess | null = null
let startedDate: number | null

process.on('exit', () => entranceProc?.kill('SIGINT'))

type ApiStatus = {
  status: string,
}

apiRouter.get('/status', authToken, (req, res) => {
  res.status(200).json({
    status: entranceProc ? 'started' : 'stop',
    started_at: entranceProc ? startedDate : undefined,
  } as ApiStatus)
})

apiRouter.post('/start', authToken, (req, res) => {

  if (entranceProc) {
    entranceProc.kill('SIGINT')
    entranceProc = null
    startedDate = null
  }

  const files: string[] = []
  let importStr = 'module.exports = {'

  const apis = getAPIs()
  const apiList = Object.keys(apis).map((key) => {
    const value = apis[key]
    switch (value.type) {
      case 'JavaScript':
        const arg = value.value.split('>')
        const filename = arg[0]
        if (!files.includes(filename)) {
          files.push(arg[0])
          importStr += `"${filename}": require("${BASE_PATH_FILE}${filename}"),`
        }
    }
    return { ...value, name: key }
  })
  importStr += `}`

  fs.writeFileSync('imports.js', importStr)

  entranceProc = child_process.fork('./entrance')
  startedDate = Date.now()
  entranceProc.on('message', (message) => {
    if (message === 'start') { res.status(200).json("ok") }
  })
  const testObject = {
    command: 'start',
    port: undefined,
    routs: apiList
  }
  entranceProc.send(testObject)
})

apiRouter.post('/stop', authToken, (req, res) => {
  if (entranceProc) {
    entranceProc.kill('SIGINT')
    entranceProc = null
    startedDate = null
    res.status(200).json('stop')
  } else {
    res.status(200).json('already stoped')
  }
})

apiRouter.get('/apis', authToken, (req, res) => {
  const apis = getAPIs()
  const apiList = Object.keys(apis).map((key) => {
    const api = apis[key]
    return { ...api, name: key }
  })
  res.status(200).json(apiList)
})

apiRouter.get('/api', authToken, (req, res) => {
  const name = (req.query.name as string)
  if (!name) { return res.sendStatus(400) }
  const api = getAPI(name)
  if (api) {
    res.status(200).json({ ...api, name })
  } else {
    res.sendStatus(400)
  }
})

apiRouter.post('/path', authToken, (req, res) => {
  const { path, name, type, value } = req.body
  if (!path || !name || !type || !value) { return res.sendStatus(400) }
  setAPI(name, { path, type, value })
  res.sendStatus(200)
})

apiRouter.put('/path', authToken, (req, res) => {
  const { path, name, type, value } = req.body
  if (!path || !name || !type || !value) { return res.sendStatus(400) }
  setAPI(name, { path, type, value })
  res.sendStatus(200)
})

apiRouter.delete('/path', authToken, (req, res) => {
  const name = req.query.name as string
  if (!name) { return res.sendStatus(400) }
  deleteAPI(name)
  res.sendStatus(202)
})

export default apiRouter
