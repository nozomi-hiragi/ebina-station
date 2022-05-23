import express, { Request, Response } from 'express'

process.on('SIGINT', () => {
  console.log('entrance: SIGINT')
  process.exit()
})

process.on('exit', () => {
  console.log('entrance: exit')
})

process.on('message', (message: any) => {
  if (message.command === 'start') {
    const port = message.port || 1234
    const app = express()
    message.routs.forEach((rout: any) => {
      // var func: ((req: Request, res: Response) => void) = () => { }
      switch (rout.type) {
        case 'static':
          app.get(rout.path, (req, res) => {
            res.status(200).json(rout.value)
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
