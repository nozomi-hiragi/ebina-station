import express from "express"
import { authToken } from "../utils/auth"
import { getMembers, removeMember } from "../utils/members"

const usersRouter = express.Router()

usersRouter.get('/users', authToken, (req, res) => {
  const members = getMembers()
  const users = Object.keys(members).map((id) => ({ ...members, id: id }))
  res.status(200).json(users)
})

usersRouter.delete('/users', authToken, (req, res) => {
  const payload = res.locals.payload
  const ids = (req.query.ids as string).split(',').filter(id => id !== payload.id)
  ids.forEach(id => { removeMember(id) })
  res.sendStatus(202)
})

export default usersRouter
