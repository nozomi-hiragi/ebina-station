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
    res.clearCookie('kumasan')
    res.clearCookie('sirokuma')
    callback(true)
  }).catch((err) => {
    console.log(err)
    callback(false)
  })
}

export const decodeJwtToken = (token: string) => {
  const payload = jwt.decode(token)
  return payload && (typeof payload !== 'string') ? payload as JwtPayload : null
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
  const tokenExp = (decodeJwtToken(tokens.token)!.exp ?? 1) * 1000
  const refreshTokenExp = (decodeJwtToken(tokens.refreshToken)!.exp ?? 1) * 1000
  res.cookie('kumasan', tokens.token, { httpOnly: true, expires: new Date(tokenExp) })
  res.cookie('sirokuma', tokens.refreshToken, { httpOnly: true, expires: new Date(refreshTokenExp) })
  return tokens
}

export const authKumasan = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token: string = req.cookies?.kumasan
  if (!token) { return res.sendStatus(400) }
  verifyAuthToken(token, (err, payload) => {
    if (err) {
      console.log(err)
      res.sendStatus(401)
    } else {
      req.cookies.token = token
      next()
    }
  })
}

export const authSirokuma = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token: string = req.cookies?.sirokuma
  if (!token) { return res.sendStatus(400) }
  verifyRefreshToken(token, (err, payload) => {
    if (err) {
      console.log(err)
      res.sendStatus(401)
    } else {
      req.cookies.token = token
      next()
    }
  })
}
