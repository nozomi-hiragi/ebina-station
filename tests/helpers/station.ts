import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import { WakeClient } from "@wake-protocol/client";
import type { EtHandlerRequest, EtHandlerResponse, WakeServer } from "@wake-protocol/server";
import { createAppHub } from "../../src/apps/hub.ts";
import { type AppHub, type AppInfo } from "../../src/apps/types.ts";
import { addUser, type IssuedRegistration } from "../../src/cli/main.ts";
import { parseStationConfig, type StationConfig } from "../../src/config.ts";
import { AppStateRepo } from "../../src/db/app_states.ts";
import { SqliteCredentialStore } from "../../src/db/credentials.ts";
import { openDatabase } from "../../src/db/mod.ts";
import { RegistrationRepo } from "../../src/db/registrations.ts";
import { UserRepo } from "../../src/db/users.ts";
import { etJson } from "../../src/et/respond.ts";
import { createEtHandler } from "../../src/et/handler.ts";
import { createHttpApp } from "../../src/http/app.ts";
import { type ProjectPaths, projectPaths } from "../../src/paths.ts";
import { setLogSink } from "../../src/log.ts";
import { createStationWake } from "../../src/wake.ts";
import { type FixtureApp, installFixtureApps } from "../fixtures/mod.ts";
import { type CreationOptions, SoftAuthenticator } from "./authenticator.ts";

const quietSink = () => {};
// テストの出力にリクエストのログを混ぜない
setLogSink(quietSink);

/** ログを集める。restore() で黙らせる状態に戻す（テストでログに秘密が出ていないかを確かめるため） */
export function captureLogs(): { lines: string[]; restore(): void } {
  const lines: string[] = [];
  setLogSink((line) => lines.push(line));
  return { lines, restore: () => setLogSink(quietSink) };
}

/** ブラウザの origin に見立てるもの（examples/station.json と同じ） */
export const TEST_ORIGIN = "http://localhost:5173";
/** WakeClient の baseUrl。app.fetch に直接渡すので、実際のネットワークには出ない */
export const TEST_BASE_URL = "http://station.test/ebina";

/** テスト用の station.json の中身。overrides で上書きする */
export function testConfigJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    port: 8787,
    origins: [TEST_ORIGIN],
    rpId: "localhost",
    rpName: "EbinaStation",
    frontURL: "http://localhost:5173/ebina-station",
    serverURL: "http://station.test",
    ...overrides,
  };
}

export function testConfig(overrides: Record<string, unknown> = {}): StationConfig {
  return parseStationConfig(testConfigJson(overrides));
}

/** AppInfo の組み立て（既定は有効で実行中の埋め込みアプリ） */
export function fakeApp(name: string, overrides: Partial<AppInfo> = {}): AppInfo {
  return { name, label: name, enabled: true, status: "running", kind: "embedded", ...overrides };
}

/** 偽の AppHub に渡された中継の呼び出し */
export interface RelayCall {
  name: string;
  path: string;
  req: EtHandlerRequest;
  userId: string;
}

export interface FakeHub extends AppHub {
  /** relay が呼ばれた順の記録 */
  readonly calls: RelayCall[];
  apps: AppInfo[];
}

/** 子プロセスを使わない偽の AppHub。relay は引数を記録して respond の結果（既定は 200 `{"relayed":true}`）を返す */
export function createFakeHub(
  options: { apps?: AppInfo[]; respond?: (call: RelayCall) => EtHandlerResponse | Promise<EtHandlerResponse> } = {},
): FakeHub {
  const calls: RelayCall[] = [];
  const hub: FakeHub = {
    calls,
    apps: options.apps ?? [],
    list: () => [...hub.apps].sort((a, b) => a.name.localeCompare(b.name)),
    get: (name) => hub.apps.find((a) => a.name === name),
    relay: async (name, path, req, userId) => {
      const call: RelayCall = { name, path, req, userId };
      calls.push(call);
      return options.respond ? await options.respond(call) : etJson(200, { relayed: true });
    },
    start: () => Promise.resolve(),
    reload: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
  return hub;
}

/** 一時フォルダに project を作って組み立てた Station（DB、WAKE、HTTP）。`await using` で後始末される */
export interface TestStation extends AsyncDisposable {
  paths: ProjectPaths;
  config: StationConfig;
  db: DatabaseSync;
  users: UserRepo;
  credentials: SqliteCredentialStore;
  registrations: RegistrationRepo;
  hub: AppHub;
  wake: WakeServer;
  app: Hono;
  /** app.fetch に直接つなぐ fetch（ネットワークは使わない） */
  fetch: typeof fetch;
  /** 登録の API などへの JSON リクエスト。path は `/ebina` からの続き */
  json(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: unknown }>;
  /** authenticator をパスキーとして使う WakeClient */
  client(auth: SoftAuthenticator): WakeClient;
  close(): Promise<void>;
}

/** 登録の API などへの JSON リクエストを送る関数を作る。base は `/ebina` までの URL */
export function jsonRequester(fetchFn: typeof fetch, base: string): TestStation["json"] {
  return async (path, init = {}) => {
    const res = await fetchFn(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? {} : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, body: text === "" ? null : JSON.parse(text) };
  };
}

export interface TestStationOptions {
  /** 差し替える AppHub（偽物など）。apps と同時には指定できない */
  hub?: AppHub;
  /**
   * tests/fixtures/apps から apps/ に写すアプリ。指定すると本物の AppHub（子プロセスを起動する）を使う。
   * 子プロセスは close() で止める（`await using` で足りる）
   */
  apps?: readonly FixtureApp[];
  config?: Record<string, unknown>;
  now?: () => number;
}

export async function createTestStation(options: TestStationOptions = {}): Promise<TestStation> {
  if (options.hub !== undefined && options.apps !== undefined) {
    throw new Error("hub と apps は同時に指定できません");
  }
  const root = await Deno.makeTempDir({ prefix: "ebina-station-test-" });
  const paths = projectPaths(root);
  const configJson = testConfigJson(options.config);
  await Deno.writeTextFile(paths.config, JSON.stringify(configJson));
  const config = parseStationConfig(configJson);

  const db = openDatabase(paths.db, { root: paths.root });
  const users = new UserRepo(db);
  const credentials = new SqliteCredentialStore(db);
  const registrations = new RegistrationRepo(db, options.now);
  const hub = options.hub ??
    (options.apps === undefined ? createFakeHub() : createAppHub({ paths, states: new AppStateRepo(db) }));
  if (options.apps !== undefined) {
    // 起動に失敗したときも、作った子プロセスと一時フォルダを残さない
    try {
      await installFixtureApps(paths, options.apps);
      await hub.start();
    } catch (e) {
      await hub.stop();
      db.close();
      await Deno.remove(root, { recursive: true });
      throw e;
    }
  }
  const etHandler = createEtHandler({ config, users, credentials, hub });
  const wake = createStationWake({ config, db, credentials, etHandler });
  const app = createHttpApp({ config, wake, credentials, registrations });

  const stationFetch: typeof fetch = async (input, init) => await app.fetch(new Request(input, init));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    // 自分で作った本物の hub は、子プロセスを止めてから DB とフォルダを片付ける（止めないとリソース検査に引っかかる）
    if (options.apps !== undefined) await hub.stop();
    db.close();
    await Deno.remove(root, { recursive: true });
  };

  return {
    paths,
    config,
    db,
    users,
    credentials,
    registrations,
    hub,
    wake,
    app,
    fetch: stationFetch,
    json: jsonRequester(stationFetch, "http://station.test/ebina"),
    client: (auth) => new WakeClient({ baseUrl: TEST_BASE_URL, getAssertion: auth.getAssertion, fetch: stationFetch }),
    close,
    [Symbol.asyncDispose]: close,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCreationOptions(value: unknown): value is CreationOptions {
  return isRecord(value) && isRecord(value.rp) && isRecord(value.user) && typeof value.challenge === "string";
}

/** HTTP の登録の API で、パスキーを登録する（info → options → verify）。失敗したら例外 */
export async function registerPasskey(
  station: Pick<TestStation, "json">,
  auth: SoftAuthenticator,
  issued: Pick<IssuedRegistration, "token" | "code">,
): Promise<void> {
  const info = await station.json(`/register/info?token=${encodeURIComponent(issued.token)}`);
  if (info.status !== 200) throw new Error(`register/info が ${info.status}`);
  const options = await station.json("/register/options", { body: { token: issued.token, code: issued.code } });
  if (options.status !== 200 || !isCreationOptions(options.body)) {
    throw new Error(`register/options が ${options.status}: ${JSON.stringify(options.body)}`);
  }
  const response = await auth.register(options.body);
  const verify = await station.json("/register/verify", { body: { token: issued.token, response } });
  if (verify.status !== 200) throw new Error(`register/verify が ${verify.status}: ${JSON.stringify(verify.body)}`);
}

/** ユーザーを作り（CLI の add と同じ関数）、パスキーを登録し、ログインした WakeClient を返す */
export async function createLoggedInUser(
  station: TestStation,
  id: string,
  name: string,
  auth: SoftAuthenticator = new SoftAuthenticator(TEST_ORIGIN),
): Promise<{ client: WakeClient; auth: SoftAuthenticator }> {
  const issued = addUser({ config: station.config, db: station.db }, id, name);
  await registerPasskey(station, auth, issued);
  const client = station.client(auth);
  await client.login({ mode: "discoverable" });
  return { client, auth };
}
