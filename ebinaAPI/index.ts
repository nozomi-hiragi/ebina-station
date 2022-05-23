import express from "express"
import userRouter from "./user"
import usersRouter from "./users"

const ebinaRouter = express.Router()

ebinaRouter.use('/user', userRouter)
ebinaRouter.use('/users', usersRouter)

export default ebinaRouter
