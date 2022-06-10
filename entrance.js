const express = require('express')
const imports = require("./imports.js")
const Log4js = require("log4js")
Log4js.configure({
  "appenders": {
    "EbinaGenba": {
      "type": "dateFile",
      "filename": "./logs/ebinaGenba.log"
    }
  },
  "categories": {
    "default": {
      "appenders": ["EbinaGenba"],
      "level": "info"
    },
    "Genba": {
      "appenders": ["EbinaGenba"],
      "level": "info"
    }
  }
})
const logGenba = Log4js.getLogger('Genba')

process.on('SIGINT', () => {
  logGenba.info('entrance', 'SIGINT')
  process.exit()
})

process.on('exit', () => {
  logGenba.info('entrance', 'exit')
  process.send && process.send('exit')
})

process.on('message', (message) => {
  if (message.command === 'start') {
    const port = message.port || 1234
    const app = express()
    message.routs.forEach((rout) => {
      switch (rout.type) {
        case 'static':
          app.get(rout.path, (req, res) => res.status(200).json(rout.value))
          break;

        case 'JavaScript':
          const arg = (rout.value).split('>')
          app.get(rout.path, (req, res) => {
            try {
              imports[arg[0]][arg[1]](req, res)
            } catch (err) {
              logGenba.error('type: JavaScript', arg, err)
              res.sendStatus(500)
            }
          })
          break;
        default:
          break;
      }
    });
    app.listen(port, () => {
      logGenba.info(`Genma start on ${port}`)
      process.send && process.send('start')
    })
  }
})
