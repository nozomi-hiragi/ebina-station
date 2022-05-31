import "dotenv/config"
import express from "express"
import bcrypt from "bcrypt"
import * as database from "../utils/database"
import { authToken, authRefreshToken, generateToken, deleteRefreshToken } from "../utils/auth"

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
      generateToken(res, id).then((tokens) => {
        res.status(200).json({ user: { ...user, pass: undefined }, tokens })
      }).catch((err) => {
        console.log(err)
        res.sendStatus(400)
      })
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
  database.findRefreshTokenFronTokenTable(payload.id).then((token) => {
    deleteRefreshToken(res, payload.id, (isOk) => res.sendStatus(isOk ? 200 : 401))
  }).catch((err) => {
    console.log(err)
    res.sendStatus(503)
  })
})

userRouter.post('/refresh', authRefreshToken, (req, res) => {
  const payload = res.locals.payload
  const refreshToken = res.locals.refreshToken
  database.findRefreshTokenFronTokenTable(payload.id).then((tokenRow) => {
    if (tokenRow?.refresh_token !== refreshToken) { return res.sendStatus(401) }
    generateToken(res, payload.id).then((tokens) => {
      res.status(200).json(tokens)
    }).catch((err) => {
      console.log(err)
      res.sendStatus(400)
    })
  }).catch((err) => {
    console.log(err)
    res.sendStatus(503)
  })
})

userRouter.post('/verify', authToken, (req, res) => {
  const payload = res.locals.payload
  if (!payload) { return res.sendStatus(400) }
  res.status(200).json(res.locals.payload)
})

export default userRouter
