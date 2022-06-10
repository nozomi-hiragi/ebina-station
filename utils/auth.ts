import express from "express"
import jwt from "jsonwebtoken"

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

const verifyAuthToken = (token: string) => jwt.verify(token, process.env.USER_AUTH_SECRET!)
const verifyRefreshToken = (token: string) => jwt.verify(token, process.env.USER_REFRESH_SECRET!)

export const generateToken = (id: string) => {
  const tokens = generateJwtToken({ id: id })
  userTokens[id] = tokens
  return tokens
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
  try {
    const payload = verifyAuthToken(token)
    if (typeof payload === 'string') {
      new Error('payload error')
    } else {
      res.locals.token = token
      res.locals.payload = payload
      next()
    }
  } catch (err) {
    console.log(err)
    res.sendStatus(401)
  }
}

export const refreshTokens = (refreshToken: string) => {
  try {
    const payload = verifyRefreshToken(refreshToken) as JwtPayload
    if (userTokens[payload.id]?.refreshToken === refreshToken) {
      removeToken(payload.id)
      return generateToken(payload.id)
    } else {
      new Error('not logedin the user')
    }
  } catch (err) {
    console.log(err)
    return null
  }
  return null
}
