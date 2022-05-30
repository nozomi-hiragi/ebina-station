import express from "express"
import child_process from "child_process"
import { authKumasan } from "../utils/auth"
import * as apidb from '../utils/database'
import fs from 'fs'

const BASE_PATH_FILE = './project/js/'

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
  apidb.getAPIs().then((rows) => {
    if (entranceProc) {
      entranceProc.kill('SIGINT')
      entranceProc = null
      startedDate = null
    }

    const files: string[] = []
    let importStr = 'module.exports = {'

    rows = rows.map((row) => {
      switch (row.type) {
        case 'JavaScript':
          const arg = row.value.split('>')
          const filename = arg[0]
          if (!files.includes(filename)) {
            files.push(arg[0])
            importStr += `"${filename}": require("${BASE_PATH_FILE}${filename}"),`
          }
      }
      return row
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
      routs: rows
    }
    entranceProc.send(testObject)
  }).catch((err) => {
    console.log(err)
    res.sendStatus(500)
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
  apidb.getAPIs().then((rows) => {
    res.status(200).json(rows)
  }).catch((err) => {
    console.log(err)
    res.sendStatus(500)
  })
})

apiRouter.get('/api', authKumasan, (req, res) => {
  const path = (req.query.path as string)
  if (!path) { return res.sendStatus(400) }
  apidb.getAPI(path).then((row) => {
    if (row) {
      res.status(200).json(row)
    } else {
      res.sendStatus(400)
    }
  }).catch((err) => {
    console.log(err)
    res.sendStatus(500)
  })
})

apiRouter.post('/path', authKumasan, (req, res) => {
  const { path, name, type, value } = req.body
  if (!path || !name || !type || !value) { return res.sendStatus(400) }
  apidb.setAPI(path, name, type, value).then((_) => {
    res.sendStatus(200)
  }).catch((err) => {
    console.log(err)
    res.sendStatus(400)
  })
})

apiRouter.put('/path', authKumasan, (req, res) => {
  const { path, name, type, value } = req.body
  if (!path || !name || !type || !value) { return res.sendStatus(400) }
  apidb.updateAPI(path, name, type, value).then((_) => {
    res.sendStatus(200)
  }).catch((err) => {
    console.log(err)
    res.sendStatus(400)
  })
})

apiRouter.delete('/path', authKumasan, (req, res) => {
  const path = req.query.path as string
  if (!path) { return res.sendStatus(400) }
  apidb.deleteAPI(path).then((_) => {
    res.sendStatus(202)
  }).catch((err) => {
    console.log(err)
    res.sendStatus(400)
  })
})

export default apiRouter
