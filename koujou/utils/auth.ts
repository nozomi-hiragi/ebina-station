import express from "express"
import jwt from "jsonwebtoken"
import { logKoujou } from './log'

const userTokens: { [key: string]: { token: string, refreshToken: string } } = {}

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

const verifyAuthToken = (token: string) => {
  try {
    return jwt.verify(token, process.env.USER_AUTH_SECRET!) as JwtPayload
  } catch (err) {
    logKoujou.info('verifyAuthToken', token, err)
  }
}

const verifyRefreshToken = (token: string) => {
  try {
    return jwt.verify(token, process.env.USER_REFRESH_SECRET!) as JwtPayload
  } catch (err) {
    logKoujou.info('verifyRefreshToken', token, err)
  }
}

export const generateTokens = (id: string) => {
  const tokens = generateJwtToken({ id: id })
  userTokens[id] = tokens
  return tokens
}

export const isAvailableToken = (id: string, token: string) => {
  const tokens = userTokens[id]
  return tokens && tokens.token === token
}

export const removeToken = (id: string) => {
  const isLogedin = userTokens[id] !== undefined
  if (isLogedin) {
    delete userTokens[id]
  }
  return isLogedin
}

export const authToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization
  if (!authHeader) { return res.sendStatus(401) }
  const tokenArray = authHeader.split(' ')
  if (tokenArray[0] !== "Bearer") { return res.sendStatus(400) }
  const token = tokenArray[1]
  const payload = verifyAuthToken(token)
  if (payload) {
    res.locals.token = token
    res.locals.payload = payload
    next()
  } else {
    res.sendStatus(401)
  }
}

export const refreshTokens = (refreshToken: string, id?: string) => {
  const payload = verifyRefreshToken(refreshToken) as JwtPayload
  if (!payload) return undefined

  if (id && payload.id !== id) {
    removeToken(payload.id)
    logKoujou.info('refreshTokens', 'wrong user', id, payload)
    return undefined
  }

  if (userTokens[payload.id]?.refreshToken === refreshToken) {
    removeToken(payload.id)
    return generateTokens(payload.id)
  } else {
    logKoujou.info('refreshTokens', 'not logedin this user', payload)
    return undefined
  }
}
