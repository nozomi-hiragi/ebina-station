import express from "express"
import bcrypt from "bcrypt"
import base64url from "base64url"
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import { authToken, generateToken, JwtPayload, refreshTokens, removeToken } from "../utils/auth"
import { addMember, getMember, setMember, User, WebAuthn, WebAuthnAuthenticator, WebAuthnItem } from "../data/members"
import { getSettings, WebAuthnSetting } from "../data/settings"
import { logApi } from "../utils/log"

const userRouter = express.Router()

const challenges: {
  [key: string]: {
    challenge: string,
    createdAt: number
  }
} = {}

const isRPIDStatic = (webAuthnSetting: WebAuthnSetting) => {
  switch (webAuthnSetting.rpIDType) {
    case 'variable':
      return false

    default:
    case 'static':
      return true
  }
}

userRouter.post('/regist', (req, res) => {
  const { id, pass, name }: { id: string, pass: string, name: string } = req.body
  if (!id || !pass || !name) { return res.sendStatus(400) }
  if (getMember(id)) {
    logApi.info('user/regest', "already have this id", id)
    return res.sendStatus(406)
  }
  const passwordAuth = { hash: bcrypt.hashSync(pass, 9) }
  const user: User = { name, auth: { password: passwordAuth } }
  if (addMember(id, user)) res.sendStatus(201)
  else res.sendStatus(406)
})

userRouter.get('/webauthn/regist', authToken, (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const payload: JwtPayload = res.locals.payload
  const user = getMember(payload.id)
  if (!user) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(405)

  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : req.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem = userWebAuthn[rpID] ?? { authenticators: {} }
  const options = generateRegistrationOptions({
    rpName: webAuthnSetting.rpName, rpID,
    userID: payload.id, userName: user.name,
    attestationType: webAuthnSetting.attestationType,
    excludeCredentials: Object.values(webAuthnItem.authenticators).filter((authenticator) =>
      authenticator !== undefined
    ).map((authenticator) => ({
      type: 'public-key',
      id: authenticator!.credentialID,
      transports: authenticator!.transports,
    }))
  })
  challenges[payload.id] = { challenge: options.challenge, createdAt: Date.now() }
  res.status(200).json(options)
})

userRouter.post('/webauthn/regist', authToken, async (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const payload: JwtPayload = res.locals.payload
  const user = getMember(payload.id)
  if (!user) return res.sendStatus(404)
  const deviceName: string = req.body.deviceName
  if (!deviceName) return res.sendStatus(400)

  const challengeItem = challenges[payload.id]
  if (!challengeItem) return res.sendStatus(404)
  if ((Date.now() - challengeItem.createdAt) > (1000 * 60)) {
    delete challenges[payload.id]
    return res.sendStatus(405)
  }

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(405)
  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : req.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem = userWebAuthn[rpID] ?? { authenticators: {} }
  if (webAuthnItem.authenticators[deviceName]) return res.sendStatus(400)

  let verification
  try {
    verification = await verifyRegistrationResponse({
      credential: req.body,
      expectedChallenge: challengeItem.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    })
  } catch (err) {
    logApi.info('user/webauthn/regist', err)
    return res.sendStatus(400)
  }
  if (!verification.verified || !verification.registrationInfo) { return res.sendStatus(400) }

  webAuthnItem.authenticators[deviceName] = verification.registrationInfo
  userWebAuthn[rpID] = webAuthnItem
  user.auth.webAuthn = userWebAuthn
  setMember(payload.id, user)

  delete challenges[payload.id]

  res.status(200).json({ 'status': 'ok' })
})

userRouter.get('/webauthn/verify', authToken, async (req, res) => {
  const payload: JwtPayload = res.locals.payload
  const user = getMember(payload.id)
  if (!user) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(405)
  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : req.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem = userWebAuthn[rpID] ?? { authenticators: {} }

  let queryDeviceNames = req.query.deviceNames
  const deviceNames = queryDeviceNames
    ? (typeof queryDeviceNames === 'string' ? [queryDeviceNames] : queryDeviceNames as string[])
    : Object.keys(webAuthnItem.authenticators)

  const authenticators = deviceNames
    .map((deviceNames) => webAuthnItem.authenticators[deviceNames])
    .filter((a) => a) as WebAuthnAuthenticator[]

  const options = generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: authenticators.map((authenticator) => ({
      id: authenticator.credentialID,
      type: authenticator.credentialType,
      transports: authenticator.transports,
    })),
  })
  challenges[payload.id] = { challenge: options.challenge, createdAt: Date.now() }
  res.status(200).json(options)
})

userRouter.post('/webauthn/verify', authToken, async (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const payload: JwtPayload = res.locals.payload
  const user = getMember(payload.id)
  if (!user) return res.sendStatus(404)

  const challengeItem = challenges[payload.id]
  if (!challengeItem) return res.sendStatus(404)
  if ((Date.now() - challengeItem.createdAt) > (1000 * 60)) {
    delete challenges[payload.id]
    return res.sendStatus(405)
  }

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(405)
  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : req.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID]
  if (!webAuthnItem) return res.sendStatus(400)
  const deviceName = Object.keys(webAuthnItem.authenticators).find((deviceName) => {
    const authenticator = webAuthnItem.authenticators[deviceName]
    if (!authenticator) return false
    return base64url.encode(authenticator.credentialID) === req.body.id
  })
  if (!deviceName) return res.sendStatus(400)

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      credential: req.body,
      expectedChallenge: challengeItem.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: webAuthnItem.authenticators[deviceName]!,
    })
  } catch (err) {
    logApi.info('user/webauthn/verify', err);
    return res.sendStatus(400)
  }
  if (!verification.verified || !verification.authenticationInfo) { return res.sendStatus(400) }

  webAuthnItem.authenticators[deviceName]!.counter = verification.authenticationInfo.newCounter
  userWebAuthn[rpID] = webAuthnItem
  user.auth.webAuthn = userWebAuthn
  setMember(payload.id, user)

  delete challenges[payload.id]
  res.sendStatus(200)
})

userRouter.get('/webauthn/devices', authToken, async (req, res) => {
  const payload: JwtPayload = res.locals.payload
  const user = getMember(payload.id)
  if (!user) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(405)
  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : req.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID]
  if (!webAuthnItem) return res.sendStatus(404)
  res.status(200).json(Object.keys(webAuthnItem.authenticators))
})

userRouter.delete('/webauthn/device/:deviceName', authToken, async (req, res) => {
  const { deviceName } = req.params

  const payload: JwtPayload = res.locals.payload
  const user = getMember(payload.id)
  if (!user) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(405)
  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : req.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID]
  if (!webAuthnItem) return res.sendStatus(404)

  const authenticator = webAuthnItem.authenticators[deviceName]
  if (!authenticator) return res.sendStatus(400)

  delete webAuthnItem.authenticators[deviceName]
  userWebAuthn[rpID] = webAuthnItem
  user.auth.webAuthn = userWebAuthn
  setMember(payload.id, user)

  res.sendStatus(200)
})

userRouter.post('/login', (req, res) => {
  const { id, pass }: { id: string, pass: string } = req.body
  if (!id || !pass) { return res.sendStatus(400) }
  const user = getMember(id)
  if (user === undefined) {
    logApi.info('post', 'user/login', 'not exist user', id)
    return res.sendStatus(404)
  }
  const passwordAuth = user.auth.password
  if (passwordAuth === undefined) { return res.sendStatus(500) }
  if (bcrypt.compareSync(pass, passwordAuth.hash ?? '')) {
    const tokens = generateToken(id)
    if (tokens) {
      res.status(200).json({ user: { ...user, auth: undefined }, tokens })
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
