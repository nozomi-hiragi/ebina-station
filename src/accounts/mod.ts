import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import type { CredentialStore } from "@wake-protocol/server";
import type { StationConfig } from "../config.ts";
import { inTransaction } from "../db/mod.ts";
import { CredentialExistsError, SqliteCredentialStore } from "./credentials.ts";
import { createRegisterRoutes } from "./register_http.ts";
import { RegistrationRepo } from "./registrations.ts";
import { type User, UserExistsError, UserNotFoundError, UserRepo, validateUserId, validateUserName } from "./users.ts";

export type { User };
export { CredentialExistsError, UserExistsError, UserNotFoundError, validateUserId, validateUserName };

export interface AccountsDeps {
  db: DatabaseSync;
  /** registerRoutes() だけが使う。無くても管理の操作は使える（CLI の list / remove は station.json を読まない） */
  config?: StationConfig;
  /** 登録トークンの時計（テスト用）。既定は Date.now */
  now?: () => number;
}

/** 発行した登録トークン。平文のトークンは DB には残らない */
export interface IssuedToken {
  token: string;
  code: string;
  expiresAt: number;
}

/** ユーザー・パスキー・登録トークン。accounts/ の外からはこれだけを使う */
export interface Accounts {
  /** WAKE に渡すパスキーの保存先 */
  readonly wakeCredentials: CredentialStore;
  /** `/ebina/register` に付ける Hono。config が無ければ Error */
  registerRoutes(): Hono;
  /** ログイン中のユーザーと、その active なパスキーが DB に残っていればユーザー。無ければ undefined */
  checkSession(auth: { userId: string; credentialId: string }): User | undefined;
  /** ユーザーを作り、登録トークンを発行する。どちらかが失敗したら、ユーザーも作らない。同じ ID があれば UserExistsError */
  createUser(id: string, name: string): { user: User; issued: IssuedToken };
  /** 既存のユーザーに登録トークンを発行し直す。ユーザーがいなければ UserNotFoundError */
  reissueToken(id: string): { user: User; issued: IssuedToken };
  getUser(id: string): User | undefined;
  listUsers(): { user: User; passkeys: number }[];
  /** ユーザーを消す（パスキーと登録トークンも消える）。消したら true */
  removeUser(id: string): boolean;
}

export function createAccounts(deps: AccountsDeps): Accounts {
  const { db, config } = deps;
  const users = new UserRepo(db);
  const credentials = new SqliteCredentialStore(db);
  const registrations = new RegistrationRepo(db, deps.now);

  return {
    wakeCredentials: credentials,
    registerRoutes: () => {
      if (config === undefined) throw new Error("station.json の設定が無いため、登録の API を作れません");
      return createRegisterRoutes({ config, credentials, registrations });
    },
    checkSession: (auth) => {
      const user = users.get(auth.userId);
      return user && credentials.isActive(auth.credentialId, auth.userId) ? user : undefined;
    },
    createUser: (id, name) =>
      inTransaction(db, () => {
        const user = users.create(id, name);
        return { user, issued: registrations.issue(user.id) };
      }),
    reissueToken: (id) => {
      const user = users.get(id);
      if (!user) throw new UserNotFoundError(id);
      return { user, issued: registrations.issue(user.id) };
    },
    getUser: (id) => users.get(id),
    listUsers: () => users.list().map((user) => ({ user, passkeys: credentials.listByUser(user.id).length })),
    removeUser: (id) => users.remove(id),
  };
}
