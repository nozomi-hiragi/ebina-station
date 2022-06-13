import express from "express"
import userRouter from "./user"
import appRouter from './app'

const ebinaRouter = express.Router()

ebinaRouter.use('/user', userRouter)
ebinaRouter.use('/app', appRouter)

export default ebinaRouter
