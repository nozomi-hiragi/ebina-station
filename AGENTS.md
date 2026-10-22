# AGENTS.md

AI エージェント向けの作業ルール。人間向けの説明は [README.md](README.md) を参照。

## プロジェクト概要

- EbinaStation のサーバー。v2 として作り直し中。第 2 段まで実装した: `station.json`、SQLite、パスキーの登録 API、WAKE、ET の振り分け、埋め込みアプリの子プロセスと中継、CLI（第 1 段）、同梱アプリ `apps/` の走査と Binette エディタ（第 2 段）。アプリ管理の画面と API、外部アプリはまだ無い。v1 のコードは消した。参照するときは `v1.1.0` のタグを見る
- Station はクライアント（ebina-front）とアプリのあいだに立つ中継役。WAKE（KX / SM / ET）でログインとセッションを受け持ち、ET で受けたリクエストをパスの先頭のアプリ名で振り分けてアプリへ渡す。画面はアプリが Binette で返す
- 仕様は `docs/` にある。作業の前に該当する文書を読む

| 文書 | 内容 |
| --- | --- |
| `docs/spec.md` | v2 の全体の仕様 |
| `docs/station-json.md` | Station の設定ファイル |
| `docs/app-json.md` | 埋め込みアプリの設定ファイル |
| `docs/apps/<アプリ名>.md` | アプリごとの仕様（Binette エディタなど） |
| `docs/v1/` | v1 の仕様の記録（API、WebAuthn、保存データ）。v2 では使わない |

- 関連する仕様:
  - ebina-front: [AGENTS.md](https://github.com/nozomi-hiragi/ebina-front/blob/v2.0.0/AGENTS.md)、[docs/ebina-front.md](https://github.com/nozomi-hiragi/ebina-front/blob/v2.0.0/docs/ebina-front.md)。今のクライアントとの契約は、ebina-front の `src/api/station.ts` と `dev-server/app.ts`
  - Binette: [docs/spec.md](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec.md)
  - WAKE: [spec/wake-protocol.md](https://github.com/nozomi-hiragi/wake-protocol/blob/main/spec/wake-protocol.md)
- v1 の機能は `docs/v1/` を参考にしつつ、そのまま移植せず作り直す

## 役割分担

モデルを 3 段階に分け、作業内容によって担当を決める。

| 区分 | モデル | 担当 |
| --- | --- | --- |
| 高 | Opus, Sol6.1 Ultra, Astra | 方針決定、設計、指示出し、進捗の監視、レビュー、最終確認 |
| 中 | Sonnet, Sol | 複雑な実装（認証、WAKE のストア、中継、子プロセスの管理、複数ファイルにまたがる設計判断を含むもの） |
| 低 | Haiku, Luna | 仕様が明確な実装、ビネットの画面作成、修正、ドキュメント作成、定型作業 |

### 高モデルの進め方

- 実装は自分でせず、中・低モデルのサブエージェントに任せる。小さな修正も原則として差し戻す
- 中モデルに任せるかどうかは、判断を要する箇所の多さで決める。迷ったら低モデルで始め、詰まったら中モデルに切り替える
- 互いに干渉しない作業は並列で任せてよい。同じファイルを触る作業は順番に任せる
- サブエージェントの報告をそのまま信じない。差分を読み、検査（下記「開発コマンド」）を自分でも実行して確かめる
- ユーザーへの報告は、検証したことと未検証のこと（ブラウザでの動作など）を分けて書く

### 指示の書き方（高 → 中・低）

指示には次を必ず含める。受け手は会話の文脈を持っていない前提で書く。

1. 作業ディレクトリ（絶対パス）
2. 目的と、やらないこと（範囲外のファイル、未実装のままにする処理）
3. 参照すべきファイル・仕様（パスで指定）
4. 具体的な手順と、従うべき規約（このファイルの該当節を示してよい）
5. 完了条件（例: 検査が通る）
6. 報告してほしい内容（変更したファイル、検査の結果、推測で決めた点）

### 報告の書き方（中・低 → 高）

- 変更・作成・削除したファイルの一覧
- 検査の結果（末尾数行）
- 仕様に無く、自分で決めた点や推測した点
- 指示どおりにできなかった点とその理由

### レビュー観点

- 指示と仕様に合っているか。範囲外の変更が混ざっていないか
- 仕様（`docs/`）と実装がずれていないか。ずれたら仕様も直す
- クライアントから来た値（ET の URL、ヘッダー、本文）を信じすぎていないか。`Ebina-` で始まるヘッダーを捨ててから付けているか
- アプリの子プロセスに、仕様より広い権限を与えていないか
- 秘密（`Ebina-App-Token`、WAKE の `secret`、パスキーの情報）をログや応答に出していないか
- 余計な依存パッケージが増えていないか

## 開発コマンド

前提: Deno 2（2.9 で確かめている）。初めて動かすときは設定の例をコピーする。

```sh
mkdir -p project && cp examples/station.json project/station.json
deno task dev     # 開発用に起動（--watch=src/,runner/,apps/）。ebina-front の npm run dev と組む例の設定
deno task start   # 起動
deno task user    # ユーザー管理の CLI（add / token / list / remove）
deno task check   # deno fmt --check、deno lint、deno check（src/ runner/ apps/ tests/）
deno task test    # deno test（tests/）
```

- 作業の完了前に必ず `deno task check` と `deno task test` を通す
- タスクの権限は最小にしてある（すべて `--no-prompt`）。権限を足すときは、なぜ要るかを確かめてから足す

| タスク | 権限 |
| --- | --- |
| `dev`、`start` | `--allow-net --allow-read --allow-write=./project --allow-env --allow-run`（`--allow-run` は子プロセス用） |
| `user` | `--allow-read --allow-write=./project --allow-env`（ネットワークとサブプロセスは無し） |
| `test` | `--allow-read --allow-write --allow-env --allow-net=127.0.0.1,localhost --allow-run` |

- タスクが書き込めるのは `./project` だけ（`deno task` は `${VAR:-既定}` を展開できないため固定）。`EBINA_PROJECT_DIR` で別の場所を使うときは、`deno run --allow-write=<場所> …` で直接起動する。足りないときは、案内つきのエラーで終わる
- `deno.lock` は deno が更新する。依存を足したら、更新後のものも含める
- `deno.json` の `minimumDependencyAge` で、公開から 1 日たっていない版は使えない。`@binette/*` だけは同じ作者のため除外している

## 技術スタック

- Deno 2 + TypeScript。Windows は対象外（子プロセスの停止にシグナルを使う）
- Hono、`@wake-protocol/server`、`@binette/core`、`@binette/coulisses`、`@simplewebauthn/server`、`qrcode`
- 保存は SQLite（`project/data/station/station.db`、Deno 組み込みの `node:sqlite`）。スキーマは `src/db/schema.ts` の `MIGRATIONS` に足す（過去のものは書き換えない）。WAKE のセッションはメモリ（`MemoryWakeStore`）
- 依存は `deno.json` の `imports` に `npm:` か `jsr:` で書き、版を固定する。`deno.land/x` や URL の直書きの import は使わない
- Node の API は `node:` を付けて使ってよい（`node:sqlite`、`node:crypto`、`node:util`）

## 構成

```
deno.json              # imports、tasks、fmt / lint の対象
examples/station.json  # 開発用の station.json の例
runner/runner.ts       # 埋め込みアプリの子プロセスで動く。entry を読み込んで待ち受ける
apps/                  # Station に同梱するアプリ（読むだけ）。binette-editor（app.json、main.ts、names.ts、store.ts、panoplie/）
src/
├── main.ts            # 起動（設定 → DB → WAKE → HTTP の待ち受け → アプリ）と、シグナルでの終了
├── config.ts          # station.json の読み込みと検査
├── paths.ts           # project フォルダの中のパス（EBINA_PROJECT_DIR）と、同梱アプリの置き場所 BUNDLED_APPS_DIR
├── log.ts             # ログ関数（setLogSink でテストでは黙らせる）
├── wake.ts            # WAKE サーバーの組み立て
├── db/                # SQLite: mod（開く・移行）、schema、row、meta、users、credentials、registrations、app_states
├── http/              # Hono: app（CORS・ログ・WAKE へ渡す）、register（登録 API）
├── et/                # ET: handler（認証の確認と URL の振り分け）、entrance（入口のビネット）、respond（応答の小物）
├── apps/              # 埋め込みアプリ: names、manifest、links（シンボリックリンクの検査）、registry（同梱と project の走査）、supervisor、relay、static、hub、types
└── cli/               # deno task user: main、qr
tests/
├── helpers/           # authenticator（ソフトウェアのパスキー）、station（一時 project に Station を組み立てる）
├── fixtures/          # apps/（echo、notes、broken）と、一時 project に写す補助 mod.ts
├── binette_editor.test.ts / e2e_binette_editor.test.ts  # Binette エディタ（main.ts を直接呼ぶ単体と、同梱を子プロセスで動かす e2e）
└── *.test.ts
docs/                  # 仕様
```

- ET と中継の境界は `src/apps/types.ts` の `AppHub`。`et/handler.ts` は `AppHub` だけを知り、`apps/hub.ts`（`createAppHub`）が実装する
- 同梱アプリ（リポジトリの `apps/`）は、同名なら `project/apps/` が勝つ。同梱のアプリにも、シンボリックリンクの検査と子プロセスの権限を同じく掛ける。`createAppHub` は `bundledAppsDir` を渡したときだけ同梱を走査する（`startStation` は既定で `BUNDLED_APPS_DIR`、`bundledAppsDir: null` で無効）。テストでは `createTestStation({ bundled: true })` で同梱を使い、省略すれば使わない
- 同梱アプリの画面（`panoplie/`）の js は 1 画面 1 ファイルで、DOM API だけで作る。`innerHTML` にユーザーの値を入れない
- 起動の組み立ては `src/main.ts` の `startStation`。`tests/helpers/station.ts` の `createTestStation` も同じ順で組み立てる。組み立てを変えたら両方を直す

## テストの書き方

- `deno test` で動かし、ネットワークは `127.0.0.1` / `localhost` だけを使う（`Deno.serve` や `Deno.listen` は `hostname: "127.0.0.1"` を明示する。既定の `0.0.0.0` は権限に入っていない）
- 一時フォルダは `Deno.makeTempDir` で作り、終わったら消す。DB やアプリを置く project は `createTestStation` か `makeProject`（`tests/fixtures/mod.ts`）で作る
- フィクスチャのアプリ（`tests/fixtures/apps`）は、そのまま使わず一時 project に写して使う（データフォルダが fixtures に書き込まれないように）。`createTestStation({ apps: ["echo"] })` は写して本物の `AppHub` を起動する
- **子プロセスを使うテストは、終わったら必ず止める。** `createTestStation` は `await using` で止まる。`createAppHub` や `startStation` を直接使うときは `try / finally` で `hub.stop()` / `station.stop()` を呼ぶ。止め忘れると Deno のリソース検査で失敗するか、子プロセスが残る
- Deno のリソース検査に引っかからないよう、タイマー・接続・`fetch` の応答本文（読むか `body?.cancel()`）も閉じる
- 止まらなくなったテストを止めるときは、`pkill -f "deno test"` のように広く止めず、pid を指定する（ほかの実行も止まる）
- ログは `tests/helpers/station.ts` を import すると黙る。ログの中身を調べるときは `captureLogs()` を使う（トークンなどの秘密が出ていないことの確認に使う）
- 登録からログインまでを通すときは、ソフトウェアのパスキー（`SoftAuthenticator`）と `createLoggedInUser`、`@wake-protocol/client` の `WakeClient` を使う。`app.fetch` を `fetch` に渡せば、ネットワークを使わずに通せる
- 実際のコマンドとして起動して確かめるテストは `tests/process.test.ts`（終了コード、案内、シグナル）

## 仕様と契約のルール

- 仕様（`docs/`）を変える実装は、同じ変更で文書も直す
- クライアントとの契約（登録の API、WAKE のパス、ET の URL と応答）を変えるときは、ebina-front の `src/api/station.ts` と `dev-server/app.ts` も合わせて直す必要がある。変える前にユーザーに確かめる
- ET で運ぶ URL は `wake://station/…` で表す。未知の URL には 404 `{"error":{"code":"not_found"}}` を返す
- アプリ名の規則と予約名は `docs/spec.md` の「アプリ名」に従う
- アプリごとの仕様は `docs/apps/<アプリ名>.md` に書き、`docs/spec.md` の「アプリ」の表に足す

## コーディング規約

- `deno fmt` と `deno lint` の既定に従う
- 型は `any` を使わない。外から来た値は検査してから使う（`@binette/core` の検査や、必要なら valibot）
- エラーの応答は日本語のメッセージにする（形は仕様の各節に従う）
- コメントは必要な箇所だけ、日本語で書く
- ファイルは小さく保つ。役割ごとにディレクトリを分ける

## Git

- コミット・push はユーザーに頼まれたときだけ行う
- コミットメッセージは日本語。1 行目に変更の要約を書く
- 作業前に `git status` を確認し、自分が触っていない変更を勝手にコミット・破棄しない
- `project/` は Station のデータなのでコミットしない
- ファイルを消すときは変数を使わず絶対パスで指定する
