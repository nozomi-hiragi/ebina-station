import express from "express"
import apiRouter from "./api"
import editRouter from "./edit"
import userRouter from "./user"
import usersRouter from "./users"

const ebinaRouter = express.Router()

ebinaRouter.use('/user', userRouter)
ebinaRouter.use('/users', usersRouter)
ebinaRouter.use('/api', apiRouter)
ebinaRouter.use('/edit', editRouter)

export default ebinaRouter
