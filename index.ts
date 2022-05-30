import express from "express"
import cors from "cors"
import ebinaRouter from "./ebinaAPI/"
import cookieParser from "cookie-parser"
import fs from "fs"

const SETTING_FILE_PATH = './project/setting.json'

if (!fs.existsSync(SETTING_FILE_PATH)) {
  fs.writeFileSync(SETTING_FILE_PATH, '')
}
const setting = JSON.parse(fs.readFileSync(SETTING_FILE_PATH, 'utf8'))

const port = setting.port === 'env' ? process.env.PORT : (setting.port || 3456)
const app = express()
app.use(express.json())
app.use(express.text())
app.use(cookieParser())
if (setting.origins) app.use(cors({ origin: setting.origins, credentials: true }))

app.use('/ebina', ebinaRouter)

app.listen(port, () => {
  console.log('lestening')
})
