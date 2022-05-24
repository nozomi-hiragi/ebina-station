import sqllite from "sqlite3"

const db = new sqllite.Database('./db.db')

// users table

const initUsersTable = () => {
  db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users(\
      id TEXT NOT NULL PRIMARY KEY,\
      name TEXT NOT NULL,\
      pass TEXT NOT NULL,\
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')),\
      created_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')));")
    db.run("CREATE TRIGGER IF NOT EXISTS users_updated_at AFTER UPDATE ON users\
      BEGIN\
      UPDATE users SET updated_at = DATETIME('now', 'localtime') WHERE rowid == NEW.rowid; \
      END;")
  })
}

export type User = {
  id: string,
  name: string,
  pass: string,
  updated_at?: string,
  created_at?: string,
}

export const insertUser = ({ id, name, pass }: User) => {
  db.run(`INSERT INTO users(id, name, pass) VALUES(\
  '${id.replaceAll(/[=']/g, '')}',\
  '${name.replaceAll(/[=']/g, '')}',\
  '${pass.replaceAll(/[=']/g, '')}'\
  );`)
}

export const findUserFronUserTable = (id: string, callback?: (err: Error | null, user?: User) => void) => {
  db.get(`SELECT id, name, updated_at, created_at FROM users WHERE id = '${id.replaceAll(/[=']/g, '')}'`, callback ? (err, row) => callback(err, row) : undefined)
}

export const getUsersFromUserTable = (callback?: (err: Error | null, users?: User[]) => void) => {
  db.all(`SELECT id, name, updated_at, created_at FROM users`, callback ? (err, rows) => callback(err, rows) : undefined)
}

export const findPassFronUserTable = (id: string, callback?: (err: Error | null, user?: User) => void) => {
  db.get(`SELECT * FROM users WHERE id = '${id.replaceAll(/[=']/g, '')}'`, callback ? (err, row) => callback(err, row) : undefined)
}

export const deleteUsers = (ids: string[], callback?: (err: Error | null) => void) => {
  ids = ids.map(id => `'${id.replaceAll(/[=']/g, '')}'`)
  db.run(`DELETE FROM users WHERE id in (${ids.join()});`, callback)
}

// tokens table

const initTokensTable = () => {
  db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS tokens(\
    id TEXT NOT NULL PRIMARY KEY,\
    refresh_token TEXT NOT NULL,\
    updated_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')),\
    created_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')));")
    db.run("CREATE TRIGGER IF NOT EXISTS tokens_updated_at AFTER UPDATE ON tokens\
    BEGIN\
    UPDATE tokens SET updated_at = DATETIME('now', 'localtime') WHERE rowid == NEW.rowid; \
    END;")
  })
}

export type Token = {
  id: string,
  refresh_token: string,
  updated_at?: string,
  created_at?: string,
}

export const replaceRefreshToken = (id: string, token: string) => {
  db.run(`REPLACE INTO tokens(id, refresh_token) VALUES(\
    '${id.replaceAll(/[=']/g, '')}',\
    '${token.replaceAll(/[=']/g, '')}'\
    );`)
}

export const findRefreshTokenFronTokenTable = (id: string, callback?: (err: Error | null, token?: Token) => void) => {
  db.get(`SELECT * FROM tokens WHERE id = '${id.replaceAll(/[=']/g, '')}'`, callback ? (err, row) => callback(err, row) : undefined)
}

export const deleteRefreshToken = (id: string, callback: (isOk: boolean) => void) => {
  db.run(`DELETE FROM tokens WHERE id ='${id.replaceAll(/[=']/g, '')}';`, (err) => {
    if (err) { console.log(err) }
    callback(!err)
  })
}

initUsersTable()
initTokensTable()
