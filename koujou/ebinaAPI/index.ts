// import express from "express"
import { oak } from "../deps.ts";
import userRouter from "./user/index.ts";
import appRouter from "./app/index.ts";

const ebinaRouter = new oak.Router();

ebinaRouter.use("/user", userRouter.routes());
ebinaRouter.use("/app", appRouter.routes());

export default ebinaRouter;
