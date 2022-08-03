// import express from "express"
import { oak } from "../deps.ts";
import userRouter from "./user/index.ts";
import appRouter from "./app/index.ts";
import projectRouter from "./project_settings/project.ts";
import databaseRouter from "./database/database.ts";

const ebinaRouter = new oak.Router();

ebinaRouter.use("/user", userRouter.routes());
ebinaRouter.use("/app", appRouter.routes());
ebinaRouter.use("/project", projectRouter.routes());
ebinaRouter.use("/database", databaseRouter.routes());

export default ebinaRouter;
