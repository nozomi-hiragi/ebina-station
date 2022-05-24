import sqllite from "sqlite3"

const db = new sqllite.Database('./api.db')

const initAPITable = () => {
  db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS api(\
    path TEXT NOT NULL PRIMARY KEY,\
    name TEXT NOT NULL,\
    type TEXT NOT NULL,\
    value TEXT NOT NULL,\
    updated_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')),\
    created_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')));")
    db.run("CREATE TRIGGER IF NOT EXISTS api_updated_at AFTER UPDATE ON api\
    BEGIN\
    UPDATE api SET updated_at = DATETIME('now', 'localtime') WHERE rowid == NEW.rowid; \
    END;")
  })
}

export const setAPI = (path: string, name: string, type: string, value: string, callback?: (err: Error | null) => void) => {
  db.run(`INSERT INTO api(path, name, type, value) VALUES(\
    '${path.replaceAll(/[=']/g, '')}',\
    '${name.replaceAll(/[=']/g, '')}',\
    '${type.replaceAll(/[=']/g, '')}',\
    '${value.replaceAll(/[=']/g, '')}'\
    );`, callback)
}

export const updateAPI = (path: string, name: string, type: string, value: string, callback?: (err: Error | null) => void) => {
  db.run(`UPDATE api SET\
    name = '${name.replaceAll(/[=']/g, '')}',\
    type = '${type.replaceAll(/[=']/g, '')}',\
    value = '${value.replaceAll(/[=']/g, '')}'\
    WHERE path = '${path.replaceAll(/[=']/g, '')}';`, callback)
}

export const getAPIs = (callback?: (err: Error | null, rows: any[]) => void) => {
  db.all(`SELECT path, name, type, value, updated_at, created_at FROM api`, callback)
}

export const getAPI = (path: string, callback?: (err: Error | null, row: any) => void) => {
  db.get(`SELECT path, name, type, value, updated_at, created_at FROM api WHERE path = '${path.replaceAll(/[=']/g, '')}'`, callback)
}

export const deleteAPI = (path: string, callback: (isOk: boolean) => void) => {
  db.run(`DELETE FROM api WHERE path ='${path.replaceAll(/[=']/g, '')}';`, (err) => {
    if (err) { console.log(err) }
    callback(!err)
  })
}

initAPITable()
