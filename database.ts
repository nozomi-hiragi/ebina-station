import sqllite from "sqlite3"

const db = new sqllite.Database('./db.db')

// users table

export const initUsersTable = () => {
  db.run("CREATE TABLE IF NOT EXISTS users(\
    id TEXT NOT NULL PRIMARY KEY,\
    name TEXT NOT NULL,\
    pass TEXT NOT NULL,\
    updated_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')),\
    created_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')));\
    CREATE TRIGGER users_updated_at AFTER UPDATE ON users\
    BEGIN\
    UPDATE users SET updated_at = DATETIME('now', 'localtime') WHERE rowid == NEW.rowid; \
    END;")
}

export const insertUser = (id: string, name: string, pass: string) => {
  db.run(`INSERT INTO users(id, name, pass) VALUES('${id}', '${name}', '${pass}');`)
}

export const findIdFronUserTable = (id: string, callback?: (err: Error | null, row: any) => void) => {
  db.get(`SELECT * FROM users WHERE id = '${id}'`, callback)
}

// tokens table

export const initTokensTable = () => {
  db.run("CREATE TABLE IF NOT EXISTS tokens(\
    id TEXT NOT NULL PRIMARY KEY,\
    refresh_token TEXT NOT NULL,\
    updated_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')),\
    created_at TEXT NOT NULL DEFAULT (DATETIME('now', 'localtime')));\
    CREATE TRIGGER tokens_updated_at AFTER UPDATE ON tokens\
    BEGIN\
    UPDATE tokens SET updated_at = DATETIME('now', 'localtime') WHERE rowid == NEW.rowid; \
    END;")
}

export const replaceRefreshToken = (id: string, token: string) => {
  db.run(`REPLACE INTO tokens(id, refresh_token) VALUES('${id}', '${token}');`)
}

export const findRefreshTokenFronTokenTable = (id: string, callback?: (err: Error | null, row: any) => void) => {
  db.get(`SELECT * FROM tokens WHERE id = '${id}'`, callback)
}
