import express from "express"
import base64url from "base64url"
import { JwtPayload } from "jsonwebtoken"
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import { getMember, WebAuthn, WebAuthnItem, setMember, WebAuthnAuthenticator } from "../../data/members"
import { getSettings, WebAuthnSetting } from "../../data/settings"
import { authToken } from "../../utils/auth"
import { logApi } from "../../utils/log"

const challenges: {
  [key: string]: {
    challenge: string,
    createdAt: number
  } | undefined
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

const webauthnRouter = express.Router()

// 登録オプション取得
// origin:
// 200 オプション
// 400 オリジンヘッダない
// 404 メンバーがない
// 500 WebAuthnの設定おかしい
webauthnRouter.get('/regist', authToken, (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const originURL = new URL(origin)

  const payload: JwtPayload = res.locals.payload
  const member = getMember(payload.id)
  if (!member) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.status(500).json({ message: 'No WebAuthn setting' })

  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : originURL.hostname
  if (!rpID) return res.status(500).json({ message: 'No rpID value' })

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem = userWebAuthn[rpID] ?? { authenticators: {} }
  const options = generateRegistrationOptions({
    rpName: webAuthnSetting.rpName, rpID,
    userID: payload.id, userName: member.name,
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

// 登録
// origin:
// { ...credential, deviceName }
// 200 OK
// 400 情報おかしい
// 401 チャレンジ失敗
// 404 メンバーがない
// 409 チャレンジ控えがない
// 410 チャレンジ古い
// 500 WebAuthnの設定おかしい
webauthnRouter.post('/regist', authToken, async (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const originURL = new URL(origin)

  const deviceName: string = req.body.deviceName
  if (!deviceName) return res.sendStatus(400)

  const payload: JwtPayload = res.locals.payload
  const member = getMember(payload.id)
  if (!member) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.status(500).json({ message: 'No WebAuthn setting' })

  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : originURL.hostname
  if (!rpID) return res.status(500).json({ message: 'No rpID value' })

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem = userWebAuthn[rpID] ?? { authenticators: {} }
  if (webAuthnItem.authenticators[deviceName]) return res.status(400).json({ message: 'Already used this device name' })

  const challengeItem = challenges[payload.id]
  if (!challengeItem) return res.sendStatus(409)
  delete challenges[payload.id]
  if ((Date.now() - challengeItem.createdAt) > (1000 * 60)) return res.sendStatus(410)

  const verification = await verifyRegistrationResponse({
    credential: req.body,
    expectedChallenge: challengeItem.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  }).catch((err) => {
    logApi.info('post', 'user/webauthn/regist', err)
    return undefined
  })
  if (!verification || !verification.verified || !verification.registrationInfo) return res.sendStatus(401)

  webAuthnItem.authenticators[deviceName] = verification.registrationInfo
  userWebAuthn[rpID] = webAuthnItem
  member.auth.webAuthn = userWebAuthn
  setMember(payload.id, member)

  res.sendStatus(200)
})

// 確認用オプション取得
// origin:
// ?names[]
// 200 オプション
// 400 情報足りない
// 404 メンバーがない
// 500 WebAuthnの設定おかしい
webauthnRouter.get('/verify', authToken, async (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const originURL = new URL(origin)

  const payload: JwtPayload = res.locals.payload
  const member = getMember(payload.id)
  if (!member) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.status(500).json({ message: 'No WebAuthn setting' })

  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : originURL.hostname
  if (!rpID) return res.status(500).json({ message: 'No rpID value' })

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem = userWebAuthn[rpID] ?? { authenticators: {} }

  const queryDeviceNames = req.query.names
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

// 認証
// origin:
// { ...credential }
// 200 OK
// 400 情報おかしい
// 401 チャレンジ失敗
// 404 ものがない
// 405 パスワードが設定されてない
// 409 チャレンジ控えがない
// 410 チャレンジ古い
// 500 WebAuthnの設定おかしい
webauthnRouter.post('/verify', authToken, async (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const originURL = new URL(origin)

  const payload: JwtPayload = res.locals.payload
  const member = getMember(payload.id)
  if (!member) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.status(500).json({ message: 'No WebAuthn setting' })

  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : originURL.hostname
  if (!rpID) return res.status(500).json({ message: 'No rpID value' })

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID]
  if (!webAuthnItem) return res.sendStatus(400)

  const challengeItem = challenges[payload.id]
  if (!challengeItem) return res.sendStatus(409)
  delete challenges[payload.id]
  if ((Date.now() - challengeItem.createdAt) > (1000 * 60)) return res.sendStatus(410)

  const deviceName = Object.keys(webAuthnItem.authenticators).find((deviceName) => {
    const authenticator = webAuthnItem.authenticators[deviceName]
    if (!authenticator) return false
    return base64url.encode(authenticator.credentialID) === req.body.id
  })
  if (!deviceName) return res.status(404).json({ message: "Can't find device from this credential id" })

  const verification = verifyAuthenticationResponse({
    credential: req.body,
    expectedChallenge: challengeItem.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: webAuthnItem.authenticators[deviceName]!,
  })
  if (!verification.verified || !verification.authenticationInfo) { return res.sendStatus(401) }

  webAuthnItem.authenticators[deviceName]!.counter = verification.authenticationInfo.newCounter
  userWebAuthn[rpID] = webAuthnItem
  member.auth.webAuthn = userWebAuthn
  setMember(payload.id, member)

  res.sendStatus(200)
})

// デバイスら情報取得
// origin:
// ?names
// 200 空でも返す
// 400 情報足りない
// 500 WebAuthnの設定おかしい
webauthnRouter.get('/device', authToken, async (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const originURL = new URL(origin)

  const deviceNames = req.query.names
    ? (typeof req.query.names === 'string' ? [req.query.names] : req.query.names as string[])
    : []

  const payload: JwtPayload = res.locals.payload
  const member = getMember(payload.id)
  if (!member) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(500)

  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : originURL.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID]
  const authenticatorNames = webAuthnItem ? Object.keys(webAuthnItem.authenticators) : []

  res.status(200).json(deviceNames.length === 0
    ? authenticatorNames
    : authenticatorNames.filter((name) => deviceNames.includes(name)))
})

// デバイスら削除
// origin:
// :deviceName
// ?names
// 200 OK
// 404 みつからない
// 500 WebAuthnの設定おかしい
webauthnRouter.delete('/device', authToken, async (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const originURL = new URL(origin)

  const deviceNames = req.query.names
    ? (typeof req.query.names === 'string' ? [req.query.names] : req.query.names as string[])
    : []

  const payload: JwtPayload = res.locals.payload
  const user = getMember(payload.id)
  if (!user) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(500)

  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : originURL.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID]
  const authenticatorNames = Object.keys(webAuthnItem?.authenticators ?? {})
  if (!webAuthnItem || authenticatorNames.length === 0) {
    return res.status(404).json({ message: 'Disable WebAuthn on this account' })
  }

  const failedNames: string[] = []
  authenticatorNames.forEach((name) => {
    const isTarget = deviceNames ? deviceNames.includes(name) : true
    if (!isTarget) return
    if (webAuthnItem.authenticators[name]) {
      delete webAuthnItem.authenticators[name]
    } else {
      failedNames.push(name)
    }
  })

  userWebAuthn[rpID] = webAuthnItem
  user.auth.webAuthn = userWebAuthn
  setMember(payload.id, user)

  if (failedNames.length === 0) {
    res.sendStatus(200)
  } else if (failedNames.length === deviceNames.length) {
    res.status(404).json({ message: "Can't find all devices" })
  } else {
    res.status(206).json({ failedNames: failedNames })
  }
})

// デバイス情報取得
// origin:
// :deviceName
// 200 空でも返す
// 400 情報足りない
// 404 みつからない
// 500 WebAuthnの設定おかしい
webauthnRouter.get('/device/:deviceName', authToken, async (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const originURL = new URL(origin)

  const { deviceName } = req.params
  if (!deviceName) return res.sendStatus(400)

  const payload: JwtPayload = res.locals.payload
  const member = getMember(payload.id)
  if (!member) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(500)

  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : originURL.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = member.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID]

  const device = webAuthnItem?.authenticators[deviceName]
  if (device) {
    res.status(200).json(deviceName)
  } else {
    res.sendStatus(404)
  }
})

// デバイス削除
// origin:
// :deviceName
// 200 OK
// 404 みつからない
// 500 WebAuthnの設定おかしい
webauthnRouter.delete('/device/:deviceName', authToken, async (req, res) => {
  const origin = req.get('origin')
  if (!origin) return res.sendStatus(400)
  const originURL = new URL(origin)

  const { deviceName } = req.params
  if (!deviceName) return res.sendStatus(400)

  const payload: JwtPayload = res.locals.payload
  const user = getMember(payload.id)
  if (!user) return res.sendStatus(404)

  const settings = getSettings()
  const webAuthnSetting = settings.WebAuthn
  if (!webAuthnSetting) return res.sendStatus(500)

  const rpID = isRPIDStatic(webAuthnSetting) ? webAuthnSetting.rpID : originURL.hostname
  if (!rpID) return res.sendStatus(500)

  const userWebAuthn: WebAuthn = user.auth.webAuthn ?? {}
  const webAuthnItem: WebAuthnItem | undefined = userWebAuthn[rpID]
  if (!webAuthnItem) return res.status(404).json({ message: 'Disable WebAuthn on this account' })

  const authenticator = webAuthnItem.authenticators[deviceName]
  if (!authenticator) return res.status(404).json({ message: "Can't find this device" })

  delete webAuthnItem.authenticators[deviceName]
  userWebAuthn[rpID] = webAuthnItem
  user.auth.webAuthn = userWebAuthn
  setMember(payload.id, user)

  res.sendStatus(200)
})

export default webauthnRouter
