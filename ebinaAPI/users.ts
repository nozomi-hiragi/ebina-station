import express from "express"
import { authKumasan, decodeJwtToken } from "../utils/auth"
import * as database from "../utils/database"

const usersRouter = express.Router()

usersRouter.get('/users', authKumasan, (req, res) => {
  database.getUsersFromUserTable((err, users) => {
    if (err) {
      console.log(err)
      return res.sendStatus(400)
    }
    res.status(200).json(users)
  })
})

usersRouter.delete('/users', authKumasan, (req, res) => {
  const token: string = req.cookies.token
  const payload = decodeJwtToken(token)!
  const ids = (req.query.ids as string).split(',').filter(id => id !== payload.id)

  database.deleteUsers(ids, (err) => {
    if (err) {
      console.log(err)
      return res.sendStatus(400)
    }
    res.sendStatus(202)
  })
})

export default usersRouter
