import "dotenv/config"
import express from "express"
import bcrypt from "bcrypt"
import * as database from "../utils/database"
import { decodeJwtToken, authKumasan, authSirokuma, generateToken, deleteRefreshToken } from "../utils/auth"

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
        const payload = decodeJwtToken(tokens.token)!
        res.status(200).json({
          id: user.id,
          name: user.name,
          created_at: user.created_at,
          updated_at: user.updated_at,
          iat: payload.iat,
          exp: payload.exp,
        })
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

userRouter.post('/logout', authKumasan, (req, res) => {
  const token: string = req.cookies.token
  if (!token) { return res.sendStatus(400) }
  const payload = decodeJwtToken(token)!
  database.findRefreshTokenFronTokenTable(payload.id).then((token) => {
    deleteRefreshToken(res, payload.id, (isOk) => res.sendStatus(isOk ? 200 : 401))
  }).catch((err) => {
    console.log(err)
    res.sendStatus(503)
  })
})

userRouter.post('/refresh', authSirokuma, (req, res) => {
  const token: string = req.cookies.token
  const payload = decodeJwtToken(token)!
  database.findRefreshTokenFronTokenTable(payload.id).then((tokenRow) => {
    if (tokenRow?.refresh_token === token) {
      generateToken(res, payload.id).then((tokens) => {
        res.status(200).json(tokens)
      }).catch((err) => {
        console.log(err)
        res.sendStatus(400)
      })
    } else {
      res.sendStatus(401)
    }
  }).catch((err) => {
    console.log(err)
    res.sendStatus(503)
  })
})

userRouter.post('/verify', authKumasan, (req, res) => {
  const token: string = req.cookies.token
  if (!token) { return res.sendStatus(400) }
  const payload = decodeJwtToken(token)
  res.status(200).json(payload)
})

export default userRouter
