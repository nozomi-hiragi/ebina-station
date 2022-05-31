import express from "express"
import jwt, { VerifyErrors } from "jsonwebtoken"
import * as database from "./database"

export type JwtPayload = {
  id: string,
  exp?: number,
  iat?: number,
}

export const generateJwtToken = (payload: JwtPayload) => {
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
  return { token: token, refreshToken: refreshToken }
}

export const deleteRefreshToken = (res: express.Response, id: string, callback: (isOk: boolean) => void) => {
  database.deleteRefreshToken(id).then((token) => {
    callback(true)
  }).catch((err) => {
    console.log(err)
    callback(false)
  })
}

const verifyJwtToken = (token: string, secret: string, callback: (err: VerifyErrors | Error | null, payload: JwtPayload | null) => void) => {
  jwt.verify(token, secret, (err, payload) => {
    if (err) {
      callback(err, null)
      return
    }
    if (!payload || typeof payload === 'string') {
      callback(Error("payload error"), null)
      return
    }
    callback(err, payload as JwtPayload)
  })
}

const verifyAuthToken = (token: string, callback: (err: VerifyErrors | Error | null, payload: JwtPayload | null) => void) =>
  verifyJwtToken(token, process.env.USER_AUTH_SECRET!, callback)

const verifyRefreshToken = (token: string, callback: (err: VerifyErrors | Error | null, payload: JwtPayload | null) => void) =>
  verifyJwtToken(token, process.env.USER_REFRESH_SECRET!, callback)

export const generateToken = async (res: express.Response, id: string) => {
  const tokens = generateJwtToken({ id: id })
  await database.replaceRefreshToken(id, tokens.refreshToken)
  return tokens
}

export const authToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization
  if (!authHeader) { return res.sendStatus(401) }
  const tokenArray = authHeader.split(' ')
  if (tokenArray[0] !== "Bearer") { return res.sendStatus(400) }
  const token = tokenArray[1]
  verifyAuthToken(token, (err, payload) => {
    if (err) {
      console.log(err)
      res.sendStatus(401)
    } else {
      res.locals.token = token
      res.locals.payload = payload
      next()
    }
  })
}

export const authRefreshToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization
  if (!authHeader) { return res.sendStatus(401) }
  const tokenArray = authHeader.split(' ')
  if (tokenArray[0] !== "Bearer") { return res.sendStatus(400) }
  const token = tokenArray[1]
  verifyRefreshToken(token, (err, payload) => {
    if (err) {
      console.log(err)
      res.sendStatus(401)
    } else {
      res.locals.refreshToken = token
      res.locals.payload = payload
      next()
    }
  })
}
