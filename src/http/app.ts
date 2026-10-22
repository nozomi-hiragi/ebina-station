import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { WakeServer } from "@wake-protocol/server";
import type { StationConfig } from "../config.ts";
import type { SqliteCredentialStore } from "../db/credentials.ts";
import type { RegistrationRepo } from "../db/registrations.ts";
import { log } from "../log.ts";
import { BadRequest, createRegisterRoutes } from "./register.ts";

export interface HttpAppDeps {
  config: StationConfig;
  wake: WakeServer;
  credentials: SqliteCredentialStore;
  registrations: RegistrationRepo;
}

/** 登録の API が受ける本文の上限（本物は 2 KiB ほど） */
const REGISTER_BODY_MAX = 64 * 1024;

/** Station の HTTP。`/ebina/auth|wake`（WAKE）と `/ebina/register`（パスキーの登録）だけを受ける */
export function createHttpApp(deps: HttpAppDeps): Hono {
  const { config, wake } = deps;
  const app = new Hono();

  // ログにクエリは出さない（登録トークンが入るため）
  app.use("*", async (c, next) => {
    await next();
    log.info(`${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status}`);
  });

  app.use(
    "/ebina/*",
    cors({
      origin: config.origins,
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      exposeHeaders: ["Content-Type", "Retry-After"],
    }),
  );

  app.onError((err, c) => {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    log.error("リクエストの処理に失敗しました", err);
    return c.json({ error: "サーバーエラーです" }, 500);
  });

  app.notFound((c) => c.json({ error: "見つかりません" }, 404));

  // パスの先頭の /ebina を取り除いて WAKE に渡す。
  // 元の Request を init に渡すと signal を読み、Deno.serve が警告を出すため、使う欄だけを写す
  const handleWake = async (c: Context) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(/^\/ebina/, "");
    const { method, headers, body } = c.req.raw;
    const res = await wake.handle(
      body === null ? new Request(url, { method, headers }) : new Request(url, { method, headers, body }),
    );
    return res ?? c.notFound();
  };
  app.all("/ebina/auth/*", handleWake);
  app.all("/ebina/wake/*", handleWake);

  app.use(
    "/ebina/register/*",
    bodyLimit({
      maxSize: REGISTER_BODY_MAX,
      onError: (c) => c.json({ error: "リクエストが大きすぎます" }, 413),
    }),
  );
  app.route("/ebina/register", createRegisterRoutes(deps));

  return app;
}
