import "dotenv/config"
import express from "express"
import bcrypt from "bcrypt"
import * as database from "../utils/database"
import { authToken, generateToken, refreshTokens, removeToken } from "../utils/auth"

const userRouter = express.Router()

userRouter.post('/regist', (req, res) => {
  const { id, pass, name }: { id: string, pass: string, name: string } = req.body
  if (!id || !pass || !name) { return res.sendStatus(400) }
  database.findUser(id).then((user) => {
    if (user && user.id === id) {
      console.log("already have this id")
      res.sendStatus(406)
    } else {
      database.createUser(id, name, bcrypt.hashSync(pass, 9)).then(() => {
        res.sendStatus(201)
      }).catch((err) => {
        console.log(err)
        res.sendStatus(400)
      })
    }
  }).catch((err) => {
    console.log(err)
    res.sendStatus(406)
  })
})

userRouter.post('/login', (req, res) => {
  const { id, pass }: { id: string, pass: string } = req.body
  if (!id || !pass) { return res.sendStatus(400) }
  database.findUserWithPass(id).then((user) => {
    if (!user) {
      res.sendStatus(503)
    } else if (bcrypt.compareSync(pass, user.pass ?? '')) {
      const tokens = generateToken(id)
      if (tokens) {
        res.status(200).json({ user: { ...user, pass: undefined }, tokens })
      } else {
        res.sendStatus(400)
      }
    } else {
      res.sendStatus(400)
    }
  }).catch((err) => {
    console.log(err)
    res.sendStatus(503)
  })
})

userRouter.post('/logout', authToken, (req, res) => {
  const payload = res.locals.payload
  res.sendStatus(removeToken(payload.id) ? 200 : 401)
})

userRouter.post('/refresh', (req, res) => {
  const refreshToken = req.body.refreshToken
  const tokens = refreshTokens(refreshToken)
  if (tokens) {
    res.status(200).json(tokens)
  } else {
    res.sendStatus(400)
  }
})

userRouter.post('/verify', authToken, (req, res) => {
  const payload = res.locals.payload
  if (!payload) { return res.sendStatus(400) }
  res.status(200).json(res.locals.payload)
})

export default userRouter
