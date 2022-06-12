import express from "express"
import { authToken } from "../utils/auth"
import userRouter from "./user"
import usersRouter from "./users"
import app, { getAppList } from './App'

const ebinaRouter = express.Router()

ebinaRouter.use('/user', userRouter)
ebinaRouter.use('/users', usersRouter)
ebinaRouter.use('/app', app)
ebinaRouter.get('/apps', authToken, (req, res) => res.status(200).json(getAppList()))

export default ebinaRouter
