import express from "express"
import cors from "cors"
import ebinaRouter from "./ebinaAPI/"
import cookieParser from "cookie-parser"
import { getSettings } from "./utils/settings"

const settings = getSettings()

const port = settings.getPort()
const app = express()
app.use(express.json())
app.use(express.text())
app.use(cookieParser())
if (settings.origins) app.use(cors({ origin: settings.origins, credentials: true }))

app.use('/ebina', ebinaRouter)

app.listen(port, () => {
  console.log('lestening')
})
