import express from "express"
import { authToken } from "../utils/auth"
import * as database from "../utils/database"

const usersRouter = express.Router()

usersRouter.get('/users', authToken, (req, res) => {
  database.getUsers().then((users) => {
    res.status(200).json(users)
  }).catch((err) => {
    if (err) {
      console.log(err)
      return res.sendStatus(400)
    }
  })
})

usersRouter.delete('/users', authToken, (req, res) => {
  const payload = res.locals.payload
  const ids = (req.query.ids as string).split(',').filter(id => id !== payload.id)
  database.deleteUsers(ids).then((err) => {
    res.sendStatus(202)
  }).catch((err) => {
    console.log(err)
    res.sendStatus(400)
  })
})

export default usersRouter
