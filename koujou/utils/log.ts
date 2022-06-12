import Log4js from "log4js"

Log4js.configure({
  "appenders": {
    "Ebina": {
      "type": "dateFile",
      "filename": "./logs/ebina.log"
    },
    "EbinaAPI": {
      "type": "dateFile",
      "filename": "./logs/ebinaAPI.log"
    }
  },
  "categories": {
    "default": {
      "appenders": [
        "Ebina"
      ],
      "level": "info"
    },
    "Koujou": {
      "appenders": [
        "Ebina"
      ],
      "level": "info"
    },
    "API": {
      "appenders": [
        "EbinaAPI"
      ],
      "level": "info"
    }
  }
})

export const logKoujou = Log4js.getLogger('Koujou')
export const logApi = Log4js.getLogger('API')
