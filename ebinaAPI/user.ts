import "dotenv/config"
import express from "express"
import bcrypt from "bcrypt"
import { authToken, generateToken, refreshTokens, removeToken } from "../utils/auth"
import { addMember, getMember, User } from "../utils/members"

const userRouter = express.Router()

userRouter.post('/regist', (req, res) => {
  const { id, pass, name }: { id: string, pass: string, name: string } = req.body
  if (!id || !pass || !name) { return res.sendStatus(400) }
  if (getMember(id)) {
    console.log("already have this id")
    return res.sendStatus(406)
  }
  const passwordAuth = { hash: bcrypt.hashSync(pass, 9) }
  const user: User = { id, name, auth: { password: passwordAuth } }
  if (addMember(id, user)) res.sendStatus(201)
  else res.sendStatus(406)
})

userRouter.post('/login', (req, res) => {
  const { id, pass }: { id: string, pass: string } = req.body
  if (!id || !pass) { return res.sendStatus(400) }
  const user = getMember(id)
  if (user === undefined) { return res.sendStatus(404) }
  const passwordAuth = user.auth.password
  if (passwordAuth === undefined) { return res.sendStatus(500) }
  if (bcrypt.compareSync(pass, passwordAuth.hash ?? '')) {
    const tokens = generateToken(id)
    if (tokens) {
      res.status(200).json({ user: { ...user, pass: undefined }, tokens })
    } else {
      res.sendStatus(400)
    }
  } else {
    res.sendStatus(400)
  }
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
