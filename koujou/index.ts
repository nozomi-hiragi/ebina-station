import "dotenv/config"
import express from "express"
import cors from "cors"
import ebinaRouter from "./ebinaAPI"
import cookieParser from "cookie-parser"
import { getSettings } from "./data/settings"
import { logKoujou } from "./utils/log"

const settings = getSettings()

const port = settings.getPort()
const app = express()
app.use(express.json())
app.use(express.text())
app.use(cookieParser())
if (settings.origins) app.use(cors({ origin: settings.origins, credentials: true }))

app.use('/ebina', ebinaRouter)

app.listen(port, () => {
  logKoujou.info(`EbinaStation Start lestening on ${port}`)
})
