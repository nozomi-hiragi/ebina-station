import "dotenv/config"
import express from "express"
import bcrypt from "bcrypt"
import * as database from "../utils/database"
import { decodeJwtToken, authKumasan, authSirokuma, generateToken, deleteRefreshToken } from "../utils/auth"

const userRouter = express.Router()

userRouter.post('/regist', (req, res) => {
  const { id, pass, name }: { id: string, pass: string, name: string } = req.body
  if (!id || !pass || !name) { return res.sendStatus(400) }
  database.findUserFronUserTable(id, (err, user) => {
    if (err) {
      console.log(err)
      res.sendStatus(406)
    } else if (user && user.id === id) {
      console.log("already have this id")
      res.sendStatus(406)
    } else {
      database.insertUser({ id: id, name: name, pass: bcrypt.hashSync(pass, 9), })
      res.sendStatus(201)
    }
  })
})

userRouter.post('/login', (req, res) => {
  const { id, pass }: { id: string, pass: string } = req.body
  if (!id || !pass) { return res.sendStatus(400) }
  database.findPassFronUserTable(id, (err, user) => {
    if (err || !user) {
      console.log(err)
      res.sendStatus(503)
    } else if (bcrypt.compareSync(pass, user.pass ?? '')) {
      const tokens = generateToken(res, id)
      const payload = decodeJwtToken(tokens.token)!
      res.status(200).json({
        id: user.id,
        name: user.name,
        created_at: user.created_at,
        updated_at: user.updated_at,
        iat: payload.iat,
        exp: payload.exp,
      })
    } else {
      res.sendStatus(400)
    }
  })
})

userRouter.post('/logout', authKumasan, (req, res) => {
  const token: string = req.cookies.token
  if (!token) { return res.sendStatus(400) }
  const payload = decodeJwtToken(token)!
  database.findRefreshTokenFronTokenTable(payload.id, (err, token) => {
    if (err) {
      console.log(err)
      res.sendStatus(503)
    } else {
      deleteRefreshToken(res, payload.id, (isOk) => res.sendStatus(isOk ? 200 : 401))
    }
  })
})

userRouter.post('/refresh', authSirokuma, (req, res) => {
  const token: string = req.cookies.token
  const payload = decodeJwtToken(token)!
  database.findRefreshTokenFronTokenTable(payload.id, (err, tokenRow) => {
    if (err) {
      console.log(err)
      res.sendStatus(503)
    } else if (tokenRow?.refresh_token === token) {
      res.status(200).json(generateToken(res, payload.id))
    } else {
      res.sendStatus(401)
    }
  })
})

userRouter.post('/verify', authKumasan, (req, res) => {
  const token: string = req.cookies.token
  if (!token) { return res.sendStatus(400) }
  const payload = decodeJwtToken(token)
  res.status(200).json(payload)
})

export default userRouter
