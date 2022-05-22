import express from "express"
import ebinaRouter from "./ebinaAPI/"

const port = process.env.PORT || 3000
const app = express()
app.use(express.json())

app.use('/ebina', ebinaRouter)

app.listen(port, () => {
  console.log('lestening')
})
