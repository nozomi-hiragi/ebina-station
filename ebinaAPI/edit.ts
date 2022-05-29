import express from "express"
import fs from 'fs'
import { authKumasan } from "../utils/auth"

const editRouter = express.Router()

const BASE_PATH_FILE = './project/js/'

const initFolder = () => {
  if (!fs.existsSync(BASE_PATH_FILE)) fs.mkdirSync(BASE_PATH_FILE, { recursive: true })
}

editRouter.post('/js/:path', authKumasan, (req, res) => {
  try {
    const { path } = req.params
    if (!path) return res.sendStatus(400)
    initFolder()
    const fullPath = BASE_PATH_FILE + path.replaceAll('<', '/')
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

editRouter.get('/js', authKumasan, (req, res) => {
  try {
    initFolder()
    const dir = fs.readdirSync(BASE_PATH_FILE)
    res.status(200).send(dir)
  } catch (err) {
    console.log(err)
    res.send(500)
  }
})

editRouter.get('/js/:path', authKumasan, (req, res) => {
  try {
    const { path } = req.params
    if (!path) return res.sendStatus(400)
    initFolder()
    const fullPath = BASE_PATH_FILE + path.replaceAll('<', '/')
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

editRouter.patch('/js/:path', authKumasan, (req, res) => {
  try {
    const { path } = req.params
    if (!path) return res.sendStatus(400)
    const body = req.body
    const isString = typeof body === 'string'
    if (!isString) return res.sendStatus(400)
    initFolder()
    const fullPath = BASE_PATH_FILE + path.replaceAll('<', '/')
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

editRouter.delete('/js/:path', authKumasan, (req, res) => {
  try {
    const { path } = req.params
    if (!path) return res.sendStatus(400)
    initFolder()
    const fullPath = BASE_PATH_FILE + path.replaceAll('<', '/')
    if (!fs.existsSync(fullPath)) return res.sendStatus(404)
    fs.unlinkSync(fullPath)
    res.sendStatus(200)
  } catch (err) {
    console.log(err)
    res.send(500)
  }
})

export default editRouter
