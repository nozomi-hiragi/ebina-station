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
      let fnc
      switch (rout.type) {
        case 'static':
          fnc = (req, res) => res.status(200).json(rout.value)
          break;

        case 'JavaScript':
          const arg = (rout.value).split('>')
          fnc = (req, res) => {
            try {
              imports[arg[0]][arg[1]](req, res)
            } catch (err) {
              logGenba.error('type: JavaScript', arg, err)
              res.sendStatus(500)
            }
          }
          break;
        default:
          fnc = (req, res) => { res.sendStatus(404) }
          break;
      }
      switch (rout.method) {
        default:
        case 'get':
          app.get(rout.path, fnc)
          break;
        case 'head':
          app.head(rout.path, fnc)
          break;
        case 'post':
          app.post(rout.path, fnc)
          break;
        case 'put':
          app.put(rout.path, fnc)
          break;
        case 'delete':
          app.delete(rout.path, fnc)
          break;
        case 'options':
          app.options(rout.path, fnc)
          break;
        case 'patch':
          app.patch(rout.path, fnc)
          break;
      }
    });
    app.listen(port, () => {
      logGenba.info(`Genma start on ${port}`)
      process.send && process.send('start')
    })
  }
})
