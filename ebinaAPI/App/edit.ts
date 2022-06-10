import express from "express"
import fs from 'fs'
import { PROJECT_PATH } from "."
import { authToken } from "../../utils/auth"
import { mkdirIfNotExist } from "../../utils/utils"

const editRouter = express.Router()

const initFolder = (appName: string) => {
  mkdirIfNotExist(`${PROJECT_PATH}/${appName}/js`)
}

editRouter.post('/js/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  try {
    const { path } = req.params
    if (!path) return res.sendStatus(400)
    initFolder(appName)
    const fullPath = `${PROJECT_PATH}/${appName}/js/${path}`
    if (fs.existsSync(fullPath)) return res.sendStatus(409)
    const body = req.body
    const isString = typeof body === 'string'
    fs.writeFile(fullPath, isString ? body : '', {}, (err) => {
      if (err) {
        console.log(err)
        return res.sendStatus(500)
      }
      res.sendStatus(200)
    })
  } catch (err) {
    console.log(err)
    res.send(500)
  }
})

editRouter.get('/js', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  try {
    initFolder(appName)
    const dir = fs.readdirSync(`${PROJECT_PATH}/${appName}/js`)
    res.status(200).send(dir)
  } catch (err) {
    console.log(err)
    res.send(500)
  }
})

editRouter.get('/js/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  try {
    const { path } = req.params
    if (!path) return res.sendStatus(400)
    initFolder(appName)
    const fullPath = `${PROJECT_PATH}/${appName}/js/${path}`
    if (!fs.existsSync(fullPath)) return res.sendStatus(404)
    if (fs.statSync(fullPath).isDirectory()) {
      const dir = fs.readdirSync(fullPath)
      res.status(200).send(dir)
    } else {
      const text = fs.readFileSync(fullPath)
      res.status(200).send(text)
    }
  } catch (err) {
    console.log(err)
    res.send(500)
  }
})

editRouter.patch('/js/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  try {
    const { path } = req.params
    if (!path) return res.sendStatus(400)
    const body = req.body
    const isString = typeof body === 'string'
    if (!isString) return res.sendStatus(400)
    initFolder(appName)
    const fullPath = `${PROJECT_PATH}/${appName}/js/${path}`
    if (!fs.existsSync(fullPath)) return res.sendStatus(404)
    fs.writeFile(fullPath, body, {}, (err) => {
      if (err) {
        console.log(err)
        return res.sendStatus(500)
      }
      res.sendStatus(200)
    })
  } catch (err) {
    console.log(err)
    res.send(500)
  }
})

editRouter.delete('/js/:path', authToken, (req, res) => {
  const appName = res.locals.appName
  if (!appName) return res.sendStatus(400)
  try {
    const { path } = req.params
    if (!path) return res.sendStatus(400)
    initFolder(appName)
    const fullPath = `${PROJECT_PATH}/${appName}/js/${path}`
    if (!fs.existsSync(fullPath)) return res.sendStatus(404)
    fs.unlinkSync(fullPath)
    res.sendStatus(200)
  } catch (err) {
    console.log(err)
    res.send(500)
  }
})

export default editRouter
