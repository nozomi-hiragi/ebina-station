import express from "express"
import cors from "cors"
import ebinaRouter from "./ebinaAPI/"
import cookieParser from "cookie-parser"

const port = process.env.PORT || 3456
const app = express()
app.use(express.json())
app.use(cookieParser())
app.use(cors({ origin: 'http://localhost:3000', credentials: true }))

app.use('/ebina', ebinaRouter)

app.listen(port, () => {
  console.log('lestening')
})
