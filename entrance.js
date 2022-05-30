const express = require('express')
const imports = require("./imports.js")

process.on('SIGINT', () => {
  console.log('entrance: SIGINT')
  process.exit()
})

process.on('exit', () => {
  console.log('entrance: exit')
})

process.on('message', (message) => {
  if (message.command === 'start') {
    const port = message.port || 1234
    const app = express()
    message.routs.forEach((rout) => {
      switch (rout.type) {
        case 'static':
          app.get(rout.path, (req, res) => {
            res.status(200).json(rout.value)
          })
          break;
        case 'JavaScript':
          const arg = (rout.value).split('>')
          app.get(rout.path, (req, res) => {
            try {
              imports[arg[0]][arg[1]](req, res)
            } catch (err) {
              console.log(err)
              res.sendStatus(500)
            }
          })
          break;
        default:
          break;
      }
    });
    app.listen(port, () => {
      console.log('start entrance:', port)
      process.send && process.send('start')
    })
  }
})
