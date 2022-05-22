import express from "express"
import userRouter from "./user"

const ebinaRouter = express.Router()

ebinaRouter.use('/user', userRouter)

export default ebinaRouter
