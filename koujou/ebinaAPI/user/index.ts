import express from "express"
import bcrypt from "bcrypt"
import { authToken, generateTokens, refreshTokens, removeToken } from "../../utils/auth"
import { addMember, getMember, User } from "../../data/members"
import { logApi } from "../../utils/log"
import { getMembers, removeMember } from "../../data/members"
import webauthnRouter from "./webauthn"

const userRouter = express.Router()

// funcs
const createUser = (name: string, pass: string) => {
  const passwordAuth = { hash: bcrypt.hashSync(pass, 9) }
  const user: User = { name, auth: { password: passwordAuth } }
  return user
}

const registUser = (id: string, name: string, pass: string) => {
  if (getMember(id)) return false
  const user = createUser(name, pass)
  return addMember(id, user)
}

const getMembersArray = (ids: string[]) => {
  const members = getMembers()
  const memberIds = Object.keys(members)
  return memberIds
    .filter((id) => ids.length !== 0 ? ids.includes(id) : true)
    .map((id) => ({ ...members[id], id, auth: undefined }))
}

// メンバー作成
// { id, name, pass }
// 201 できた
// 400 情報足らない
// 406 IDがもうある
userRouter.post('/', (req, res) => {
  const { id, name, pass }: { id: string, pass: string, name: string } = req.body
  if (!id || !name || !pass) return res.sendStatus(400)

  if (registUser(id, name, pass)) {
    res.sendStatus(201)
  } else {
    logApi.info('user/regest', "already have this id", id)
    res.sendStatus(406)
  }
})

// メンバー配列取得 ID無いなら全部
// ?ids
// 200 空でも返す
userRouter.get('/', authToken, (req, res) => {
  const ids = req.query.ids
    ? (typeof req.query.ids === 'string' ? [req.query.ids] : req.query.ids as string[])
    : []

  res.status(200).json(getMembersArray(ids))
})

// メンバー配列削除
// ?ids
// 200 全部できた
// 206 一部できた
// 404 全部できない
userRouter.delete('/', authToken, (req, res) => {
  const payload = res.locals.payload
  const ids = req.query.ids
    ? (typeof req.query.ids === 'string' ? [req.query.ids] : req.query.ids as string[])
    : []

  const failedIds: string[] = []
  ids.forEach(id => { if (!removeMember(id)) failedIds.push(id) })
  if (failedIds.length === ids.length) {
    res.sendStatus(404)
  } else if (failedIds.length === 0) {
    res.sendStatus(200)
  } else {
    res.status(206).json({ failedIDs: failedIds })
  }
})

// メンバー取得
// :id
// 200 メンバー
// 400 IDない
// 404 みつからない
userRouter.get('/:id', authToken, (req, res) => {
  const { id } = req.params
  if (!id) return res.sendStatus(400)

  const member = getMember(id)
  if (member) {
    res.status(200).json({ ...member, auth: undefined })
  } else {
    res.sendStatus(404)
  }
})

// パスワードでログイン
// { id, pass }
// 200 ユーザーとトークン
// 400 情報足らない
// 401 パスワードが違う
// 404 メンバーない
// 405 パスワードが設定されてない
userRouter.post('/login', (req, res) => {
  const { id, pass }: { id: string, pass: string } = req.body
  if (!id || !pass) return res.sendStatus(400)

  const user = getMember(id)
  if (user === undefined) {
    logApi.info('post', 'user/login', 'not exist user', id)
    return res.sendStatus(404)
  }

  const passwordAuth = user.auth.password
  if (!passwordAuth || !passwordAuth.hash) return res.sendStatus(405)

  if (bcrypt.compareSync(pass, passwordAuth.hash)) {
    const tokens = generateTokens(id)
    res.status(200).json({ user: { ...user, auth: undefined }, tokens })
  } else {
    res.sendStatus(401)
  }
})

// ログアウト サーバー内のトークン消す
// 200 消せた
// 401 無かった
userRouter.post('/logout', authToken, (req, res) => {
  const payload = res.locals.payload
  res.sendStatus(removeToken(payload.id) ? 200 : 401)
})

// トークン更新
// { refreshToken }
// 200 新トークン
// 400 リフレッシュトークンない
// 401 リフレッシュトークンおかしい
userRouter.post('/refresh', (req, res) => {
  const refreshToken = req.body.refreshToken
  if (!refreshToken) return res.sendStatus(400)

  const tokens = refreshTokens(refreshToken)
  if (tokens) {
    res.status(200).json(tokens)
  } else {
    res.sendStatus(401)
  }
})

// トークン使えるか確認
// 200 ペイロード
// 500 authToken内でペイロードとれてない
userRouter.post('/verify', authToken, (req, res) => {
  const payload = res.locals.payload
  if (!payload) return res.sendStatus(500)
  res.status(200).json(payload)
})

userRouter.use('/webauthn', webauthnRouter)

export default userRouter
