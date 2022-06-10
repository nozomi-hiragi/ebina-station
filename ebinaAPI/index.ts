import express from "express"
import { authToken } from "../utils/auth"
import userRouter from "./user"
import usersRouter from "./users"
import app, { getAppList } from './App'

const ebinaRouter = express.Router()

ebinaRouter.use('/user', userRouter)
ebinaRouter.use('/users', usersRouter)
ebinaRouter.use('/:appName', (req, res, next) => {
  if (!req.params.appName) return res.sendStatus(400)
  res.locals.appName = req.params.appName
  next()
}, app)
ebinaRouter.get('/applist', authToken, (req, res) => res.status(200).json(getAppList()))

export default ebinaRouter
