import express from "express"
import child_process from "child_process"
import { authKumasan } from "../utils/auth"
import * as apidb from '../utils/apidb'

const apiRouter = express.Router()
let entranceProc: child_process.ChildProcess | null = null
let startedDate: number | null

process.on('exit', () => entranceProc?.kill('SIGINT'))

type ApiStatus = {
  status: string,
}

apiRouter.get('/status', authKumasan, (req, res) => {
  res.status(200).json({
    status: entranceProc ? 'started' : 'stop',
    started_at: entranceProc ? startedDate : undefined,
  } as ApiStatus)
})

apiRouter.post('/start', authKumasan, (req, res) => {
  apidb.getAPIs((err, rows) => {
    if (err) {
      console.log(err)
      return res.sendStatus(500)
    }

    if (entranceProc) {
      entranceProc.kill('SIGINT')
      entranceProc = null
      startedDate = null
    }
    entranceProc = child_process.fork('./entrance')
    startedDate = Date.now()
    entranceProc.on('message', (message) => {
      if (message === 'start') { res.status(200).json("ok") }
    })
    const testObject = {
      command: 'start',
      port: undefined,
      routs: rows
    }
    entranceProc.send(testObject)
  })
})

apiRouter.post('/stop', authKumasan, (req, res) => {
  if (entranceProc) {
    entranceProc.kill('SIGINT')
    entranceProc = null
    startedDate = null
    res.status(200).json('stop')
  } else {
    res.status(200).json('already stoped')
  }
})

apiRouter.get('/apis', authKumasan, (req, res) => {
  apidb.getAPIs((err, rows) => {
    if (err) {
      console.log(err)
      return res.sendStatus(500)
    }
    res.status(200).json(rows)
  })
})

apiRouter.post('/path', authKumasan, (req, res) => {
  const { path, name, type, value } = req.body
  if (!path || !name || !type || !value) { return res.sendStatus(400) }
  apidb.setAPI(path, name, type, value, (err) => {
    if (err) {
      console.log(err)
      return res.sendStatus(400)
    }
    res.sendStatus(200)
  })
})

apiRouter.put('/path', authKumasan, (req, res) => {
  const { path, name, type, value } = req.body
  if (!path || !name || !type || !value) { return res.sendStatus(400) }
  apidb.updateAPI(path, name, type, value, (err) => {
    if (err) {
      console.log(err)
      return res.sendStatus(400)
    }
    res.sendStatus(200)
  })
})

export default apiRouter
