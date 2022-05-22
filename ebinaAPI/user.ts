import "dotenv/config"
import express from "express"
import bcrypt from "bcrypt"
import * as database from "../database"
import jwt from "jsonwebtoken"

database.initUsersTable()
database.initTokensTable()

const userRouter = express.Router()

const generateToken = (payload: any) => {
  const id = payload['id']
  if (!id) { return null }
  const token = jwt.sign(
    payload,
    process.env.USER_AUTH_SECRET!,
    { algorithm: "HS512", expiresIn: "2d" }
  )
  const refreshToken = jwt.sign(
    payload,
    process.env.USER_REFRESH_SECRET!,
    { algorithm: "HS512", expiresIn: "30d" }
  )
  database.replaceRefreshToken(id, refreshToken)
  return {
    token: token,
    refreshToken: refreshToken
  }
}

userRouter.post('/regist', (req, res) => {
  const { id, pass, name }: { id: string, pass: string, name: string } = req.body
  if (id && pass && name) {
    database.findIdFronUserTable(id, (err, row) => {
      if (err || (row && row.id == id)) {
        console.log(err ?? "already have this id")
        return res.sendStatus(406)
      }
      database.insertUser(id, name, bcrypt.hashSync(pass, 9))
      res.sendStatus(201)
    })
  } else {
    return res.sendStatus(400)
  }
})

userRouter.post('/login', (req, res) => {
  const { id, pass }: { id: string, pass: string } = req.body
  if (id && pass) {
    database.findIdFronUserTable(id, (err, row) => {
      if (err) {
        console.log(err)
        return res.sendStatus(503)
      }
      if (bcrypt.compareSync(pass, row.pass)) {
        const tokens = generateToken({ id: id })
        res.status(200).json(tokens)
      } else {
        res.sendStatus(400)
      }
    })
  } else {
    return res.sendStatus(400)
  }
})

userRouter.post('/refresh', (req, res) => {
  const { token }: { token: string } = req.body
  if (!token) { return res.sendStatus(400) }
  const payload = jwt.decode(token)
  if (!payload) { return res.sendStatus(404) }
  const { id }: { id: string } = payload as any
  database.findRefreshTokenFronTokenTable(id, (err, row) => {
    if (err) {
      console.log(err)
      return res.sendStatus(503)
    }
    if (row.refresh_token !== token) {
      return res.sendStatus(401)
    }
    jwt.verify(token, process.env.USER_REFRESH_SECRET!, (err, payload) => {
      if (err) {
        console.log(err)
        return res.sendStatus(401)
      }
      const tokens = generateToken({ id: id })
      res.status(200).json(tokens)
    })
  })
})

userRouter.post('/verify', (req, res) => {
  const { token }: { token: string } = req.body
  if (!token) {
    return res.sendStatus(400)
  }
  jwt.verify(token, process.env.USER_AUTH_SECRET!, (err, payload) => {
    if (err) {
      console.log(err)
      return res.sendStatus(401)
    }
    res.status(200).json(payload)
  })
})

export default userRouter
