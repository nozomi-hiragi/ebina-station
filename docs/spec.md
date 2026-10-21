# EbinaStation v2 仕様（下書き）

EbinaStation v2 は、クライアント（ebina-front）とアプリのあいだに立つ中継役です。ログインとセッションを受け持ち、クライアントからのリクエストをアプリへ渡し、アプリの応答を返します。業務の画面はアプリが Binette で返します。

> [!WARNING]
> 下書きです。「未決のこと」に挙げた点は、まだ決まっていません。「アプリ管理」は仕様だけで、まだ実装していません。

## 呼び名

| 名前 | 意味 |
| --- | --- |
| Station | このリポジトリのサーバー。認証、中継、アプリの管理をする |
| クライアント | ebina-front。WAKE でログインし、Binette の Scene で画面を描く |
| アプリ | Station につながり、Request を受けて Response を返すもの |
| 埋め込みアプリ | `apps/<名前>/` にソースを置き、Station が子プロセスとして起動するアプリ |
| 外部アプリ | 使用者が自分で起動し、URL を Station に登録するアプリ |

## 全体像

```
クライアント ──WAKE-ET──▶ Station ──HTTP──▶ 埋め込みアプリ（子プロセス）
                           │         └──▶ 外部アプリ（独自に起動）
                           ├ 登録・ログイン・セッション（WAKE）
                           ├ パスの先頭でアプリへ振り分け
                           └ 組み込みの画面（入口、アプリ管理）
```

- クライアントと Station のあいだは、登録を除いてすべて WAKE-ET を通します。
- Station とアプリのあいだは普通の HTTP です。アプリは認証を持たず、Station が渡すユーザーを信じます。

## 技術スタック

- Deno 2（アプリの子プロセスを Deno の権限指定で閉じ込めるため）。Windows は対象外です（子プロセスの停止にシグナルを使います）
- Hono、`@wake-protocol/server`、`@binette/core`、`@binette/coulisses`（npm から使う）
- 保存: SQLite（`data/station/station.db`、Deno 組み込みの `node:sqlite`）。WAKE のセッションは保存せず、メモリに置く

## 起動と停止

`deno task start`（開発中は `deno task dev`）で起動します。

1. `station.json` を読んで検査します。無い、読めない、正しくないときは、理由（無いときは例の場所 `examples/station.json`）を標準エラーに出して終了コード 1 で終わります。対話では作りません。
2. SQLite を開き、移行を済ませます。
3. 埋め込みアプリを走査して、子プロセスを起動します。最初の起動が済むまで（READY を待ち、最長 30 秒）HTTP は待ち受けません。
4. `port` で HTTP を待ち受けます（すべてのインターフェース）。TLS は扱いません。必要なら前段のサーバーに任せます。

`SIGINT` / `SIGTERM` を受けたら、新しい接続を止め（処理中のリクエストを最長 5 秒待つ）、子プロセスをすべて止め、DB を閉じて、終了コード 0 で終わります。片付けの途中で（最初のシグナルから 1 秒以上あとに）もう一度シグナルを受けたら、片付けを待たずに終わります。

## 保存するもの

| 場所 | 入るもの |
| --- | --- |
| SQLite `data/station/station.db` | ユーザー、パスキー、登録トークン、アプリの有効・無効、WAKE の secret |
| メモリ | WAKE のセッション、埋め込みアプリのトークンとログ |

- DB は WAL で開き、権限は 0600 にします。Station と CLI が同時に開けるように、書き込みの待ちは 5 秒までにします。移行は `PRAGMA user_version` で管理します。
- WAKE の secret は 32 バイトの乱数です。初回に作って保存します。
- 登録トークンは、平文を保存しません（SHA-256 の base64url だけを持ちます）。
- アプリの有効・無効は、無効にしたものだけを持ちます（行が無ければ有効）。
- **WAKE のセッションはメモリです。** `@wake-protocol/server` はセッション鍵を取り出せない形（extractable でない CryptoKey）で作るため、ファイルに保存できません。Station を再起動すると、クライアントはセッションが無効になり、ログインし直しになります（パスキーは残ります）。

## クライアントとの契約

ebina-front v2.0.0 の `src/api/station.ts` と `dev-server/app.ts` が今の契約です。変えるときは ebina-front と合わせて変えます。

### HTTP

| パス | 内容 |
| --- | --- |
| `/ebina/register/*` | パスキーの登録（WAKE の外） |
| `/ebina/auth/*`、`/ebina/wake/*` | WAKE |
| それ以外 | 404 `{ "error": "見つかりません" }` |

- エラーは `{ "error": "<日本語のメッセージ>" }` です。想定外の例外は 500 `{ "error": "サーバーエラーです" }` にし、中身は応答に出さず、ログにだけ出します。
- ログは `METHOD パス ステータス` の 1 行です。クエリは出しません（登録トークンが入るため）。
- CORS は `station.json` の `origins` だけを許します（[station-json.md](station-json.md)）。許すメソッドは `GET`・`POST`・`OPTIONS`、許すリクエストヘッダーは `Content-Type`、読ませる応答ヘッダーは `Content-Type` と `Retry-After` です。

### WAKE の外（登録）

| メソッドとパス | 内容 |
| --- | --- |
| `GET /ebina/register/info?token=` | 登録トークンのユーザー `{ id, name }` |
| `POST /ebina/register/options` | `{ token, code }` を受け、WebAuthn の登録オプションを返す。確認コードは 5 回まで |
| `POST /ebina/register/verify` | `{ token, response }` を受け、パスキーを保存して `{ ok: true }` を返す |

- パスキーは ES256 だけ、`residentKey: required`、`userVerification: required`、`attestation: none` にします。同じユーザーの登録済みのパスキーは `excludeCredentials` に入れます。
- 登録トークンは 32 バイトの乱数（base64url）です。15 分で切れ、1 回だけ使えます。確認コードは 4 桁で、5 回間違えると無効になります。
- 本文は 64 KiB までです。
- `/verify` で検証に進んだ登録が失敗したら（400・409）、Station は覚えている challenge を捨てます。同じ challenge で何度も試せないようにするためです。やり直すときは `/options` からもう一度行います（ebina-front は押すたびに `/options` から行います）。検証に失敗した理由はログに出しますが、保存してある challenge は伏せます（`/verify` は確認コードを見ないので、challenge を知られると、登録 URL だけで登録を完了できてしまうため）。

| ステータス | メッセージ | 場合 |
| --- | --- | --- |
| 404 | 登録トークンが無効か、期限切れです | 無い、使用済み、期限切れ、確認コードを 5 回間違えた |
| 403 | 確認コードが違います（残り N 回） | 確認コードの誤り（`remaining` も返す） |
| 400 | JSON が正しくありません、先に登録を開始してください、登録情報が不正です、パスキーを検証できませんでした、公開鍵が見つかりません、公開鍵の形式が不正です、公開鍵が一致しません | 本文や登録の応答の誤り |
| 409 | このパスキーはすでに登録されています | 同じパスキーの二重登録 |
| 413 | リクエストが大きすぎます | 本文が 64 KiB を超えた |

### WAKE

- `/ebina/auth/*` と `/ebina/wake/*` は、`/ebina` を取り除いて WAKE サーバーの `handle()` に渡します。
- パスキーの保存先は SQLite、セッションの保存先はメモリ（`MemoryWakeStore`）です。
- ログインの origin は `station.json` の `origins`、RP ID は `rpId` です。

### ET の URL

ET で運ぶ URL は `wake://station/…` で表します。振り分けは、次の順に判定します。

1. ログイン中のユーザーとパスキーが DB に残っていなければ、401 `unauthorized`（下の「削除されたユーザー・パスキー」）。
2. `wake://station/` で始まらなければ 404 `not_found`。パスの区間に `.`・`..`・空（`//`。末尾の `/` は可）、`%2f`・`%5c`（大文字小文字を問わない）、デコードできない `%`、制御文字、`\` があれば 400 `invalid_url`。
3. 次の表で振り分けます。

| URL のパス | 行き先 |
| --- | --- |
| `/me` | Station。ログイン中のユーザー `{ id, name }`。GET だけ（他は 405 `method_not_allowed`） |
| `/index.bina` | Station の入口。GET だけ（他は 405） |
| `/<アプリ名>.bina` | アプリの `/index.bina` |
| `/<アプリ名>` | アプリの `/` |
| `/<アプリ名>/…` | アプリの `/…`（クエリはそのまま） |
| 予約名（`index`、`settings`、`station`、`me`、`ebina`）、アプリ名の規則に合わない名前、無いアプリ、無効なアプリ | 404 `not_found` |

`/station/…` は Station 組み込みの画面（アプリ管理など）のための名前で、今は 404 です。

Scene はパス `/<アプリ名>/a/b` から `wake://station/<アプリ名>/a/b.bina` を取ります。asset の `src` や `sh.fetch` も同じ規則で解決するので、アプリが返す URL は `/<アプリ名>/…` で書きます。これで、Binette の仕様で未決の「ビネットがどのアプリのものか」を、パスの先頭で決めることにします。

### ET の上限とエラー

ET の上限は WAKE の規則に従います。

| 項目 | 上限 |
| --- | --- |
| メソッド | 32 文字 |
| URL | 6144 文字（ASCII の印字できる文字だけ、`#` は不可） |
| ヘッダー | 名前と値の長さの合計で 8 KiB |
| 本文 | 1 MiB |

アプリの応答を待つのは 30 秒までです。

ET の応答の誤りは `{ "error": { "code": "<コード>" } }` で返します（`content-type: application/json`）。

| ステータス | code | 場合 |
| --- | --- | --- |
| 400 | `invalid_url` | URL の区間が不正、アプリへ渡せないパス（空白・`#`・`\` を含むなど） |
| 400 | `invalid_header` | ヘッダーをアプリへ渡せない |
| 401 | `unauthorized` | ログイン中のユーザーかパスキーが DB に無い（アプリが返した 401 は 502 に書き換えるので、この意味でしか出ない） |
| 404 | `not_found` | 知らない URL、予約名、無い・無効なアプリ |
| 405 | `method_not_allowed` | `/me`・`/index.bina` に GET 以外 |
| 500 | `internal` | Station の処理で想定外の例外 |
| 502 | `bad_gateway` | アプリにつながらない、時間切れ、応答が規則に合わない（401 を含む） |
| 503 | `app_unavailable` | アプリが起動していない（起動中、停止中、異常） |

WAKE 自身が返す誤り（`invalid_request`、`invalid_method`、`invalid_url`、`invalid_header` は 400、`too_large` は 413）もあります。

### 削除されたユーザー・パスキー

CLI でユーザーやパスキーを消しても、Station のメモリにある WAKE のセッションは消せません。そのため ET の処理は毎回、セッションの `userId` のユーザーと `credentialId` のパスキー（状態が `active`）が DB にあるかを確かめ、無ければ 401 `unauthorized` を返します。ebina-front は 401 でログイン画面へ戻ります。

## 入口と組み込みの画面

### 入口（`/index.bina`）

Station が作ります。GET だけです。

- 既定では、有効なアプリを名前順に並べた画面（js の asset）を返します。行にはアプリの `icon` と `label` を出し、押すとそのアプリの `/<アプリ名>` へ移ります。アプリが無いときは「アプリがありません」と出します。予約名のフォルダ（異常として扱うもの）は、アプリではないので出しません。
- `station.json` の `entrance.redirect` があるときは、そのパスへの転送（`redirect`）を返します。
- どちらにも `settings` で「アカウント」（`order: 10`、`type: "element"`、`component: "logout"`）を入れます。ログアウトの部品はクライアントが `components` に登録しています。

### アプリ管理（`/station/apps`）（未実装）

Station 組み込みのビネット（js の画面）です。操作は次のとおりです。

- 一覧: 名前、種類（埋め込み / 外部）、状態（停止 / 起動中 / 異常）
- 再読み込み: `apps/` を読み直し、増えたアプリを一覧に足す
- 有効・無効の切り替え、再起動、ログの表示（埋め込みのみ）
- 外部アプリの登録・登録解除（名前、URL）

画面から呼ぶ API は `wake://station/station/api/…` に置き、JSON で返します。v2.0.0 ではログインしたユーザーは誰でも使えます。

今は、アプリを足したり `app.json` を変えたりしたら Station を再起動します。有効・無効は DB の `app_states` に持ちますが、切り替える操作はまだありません。

## アプリへの中継

### 振り分け

1. ET の URL の最初の区切りをアプリ名とします（`wake://station/<アプリ名>/…`）。
2. アプリ名の部分を取り除き、残りをアプリへのパスにします。`<アプリ名>.bina` は `/index.bina` にします。
3. 無効なアプリや存在しないアプリは 404、起動していないアプリは 503、つながらない・時間切れ・規則に合わない応答は 502 を返します。

### アプリに渡すもの

メソッド、パス、クエリ、本文はそのまま渡します（`GET` と `HEAD` に本文は付けません）。ヘッダーは次の規則で選びます。

| 向き | 渡さないもの | 付けるもの |
| --- | --- | --- |
| クライアント → アプリ | hop-by-hop（`connection`、`keep-alive`、`proxy-authenticate`、`proxy-authorization`、`te`、`trailer`、`transfer-encoding`、`upgrade`）、`Connection` に名前が挙がっているヘッダー、`host`、`content-length`、`accept-encoding`、`Ebina-` で始まるもの（大文字小文字を問わない） | `Ebina-User`、`Ebina-App-Token` |
| アプリ → クライアント | hop-by-hop、`content-length`、`content-encoding`、`set-cookie`、`Ebina-` で始まるもの | なし |

| ヘッダー | 内容 |
| --- | --- |
| `Ebina-User` | ログイン中のユーザー ID |
| `Ebina-App-Token` | Station とそのアプリだけが知っている秘密。アプリは一致しないリクエストを拒否する |

- クライアントが送った `Ebina-` で始まるヘッダーは捨てて、Station が付け直します。
- `accept-encoding` と `content-encoding` を外すのは、Station がアプリの応答を伸ばして受け取るためです。
- 応答のヘッダー名は小文字にして返します。
- 応答のステータスが 200〜599 でないとき、ヘッダーの名前（HTTP の token）や値（`\t`、0x20〜0x7e、0x80〜0xff）が規則に合わないとき、ヘッダーの合計が 8 KiB を超えるとき、本文が 1 MiB を超えるときは、502 にします。理由はログに出します（ヘッダーの値とクエリは出しません）。
- **アプリの 401 も 502 にします。** 401 は Station が「ログインし直し」の意味で使い（ebina-front は 401 でセッションを捨ててログイン画面へ戻る）、アプリの 401 と区別できないためです。アプリは権限がないことを 403 で返します。
- リダイレクトは追わず、そのまま返します。
- `Ebina-App-Token`、ヘッダーの値、クエリはログに出しません。

### アプリ名

- 英小文字、数字、`-` だけで、英小文字で始め、63 文字までです（`^[a-z][a-z0-9-]{0,62}$`）。`apps/` のフォルダ名がそのままアプリ名です。
- 予約名（`index`、`settings`、`station`、`me`、`ebina`）は使えません。予約名と完全に同じ名前だけが対象で、`ebina-tools` のような名前は使えます。

## アプリと Station のあいだ

アプリが実装するものと、Station とのあいだの運び方は別のものです。

### アプリが実装するもの

`fetch(Request) → Response` です。アプリは次のことを前提にしてよいです。

- `Request` にはメソッド、パス（アプリの中のパス）、クエリ、本文、`Ebina-User` が入っている。
- `Ebina-App-Token` の確認は済んでいる（埋め込みアプリでは Station が用意する runner が行う）。アプリは認証を持たず、`Ebina-User` を信じる。
- 返した `Response` のステータス、ヘッダー、本文が、上の規則でクライアントに返る。

### Station とのあいだの運び方

今は `127.0.0.1` の HTTP です。これは Station の内部のことで、アプリのコードからは見えません。あとで変わることがあります（たとえば外部アプリが Station に向けてつなぐ形）。

## 埋め込みアプリ

### フォルダ

```
project/
├── station.json
├── data/
│   ├── station/station.db     # ユーザー、パスキー、登録トークン、アプリの有効・無効
│   └── apps/<アプリ名>/        # アプリごとのデータフォルダ
└── apps/<アプリ名>/
    ├── app.json
    ├── main.ts                # 任意
    └── panoplie/              # 任意。静的な .bina とファイル
```

- `project/` の場所は環境変数 `EBINA_PROJECT_DIR` で決めます。省略時は `./project` です。
- `station.json` の欄は [station-json.md](station-json.md) を参照
- `app.json` の欄と、`entry`・`panoplie/` の動きは [app-json.md](app-json.md) を参照
- `apps/` の直下のフォルダのうち、名前が規則に合い、`app.json` があるものがアプリです。`.` で始まるフォルダ、シンボリックリンクは無視します。名前が規則に合わないフォルダは、警告をログに出して無視します。フォルダの中にシンボリックリンクがあるアプリは、異常として扱います。

### 状態

| 状態 | 意味 |
| --- | --- |
| `running` | 動いている。`panoplie/` だけのアプリは、子プロセスが無いので常にこれ |
| `starting` | 起動中 |
| `stopped` | 無効にしてある |
| `error` | `app.json` が正しくない、起動できない、続けて落ちた |

### 起動

Station は有効な埋め込みアプリ（`entry` があるもの）ごとに、子プロセスを 1 つ起動します。

```
deno run --no-prompt --config=<Station の deno.json> \
  --allow-env=EBINA_PORT,EBINA_APP_TOKEN,EBINA_DATA_DIR \
  --allow-net=127.0.0.1:<ポート> \
  --allow-read=<apps/アプリ名>,<data/apps/アプリ名> \
  --allow-write=<data/apps/アプリ名> \
  --frozen --cached-only \
  runner/runner.ts <entry の file URL>
```

- パスはすべて絶対パスです。権限に渡すフォルダのパスは、起動の直前にリンクを解決したもの（`realPath`）にします。`--frozen --cached-only` で、子プロセスはモジュールを取得せず（外への通信をしない）、`deno.lock` も書き換えません。使えるのは Station の `deno.json` の `imports` にある依存のうち、`deno.lock` とキャッシュに入っているものだけです（[app-json.md](app-json.md) の「子プロセスの権限」）。
- **アプリのフォルダとデータフォルダの中に、シンボリックリンクがあれば起動しません。** Deno のパスの権限はリンクの先を解決せずに判定するため、リンクがあると権限の外のファイルを読めてしまいます。走査のときと、起動のたびに確かめます。ポートは起動のたびに OS に空きを選ばせ、`Ebina-App-Token` も起動のたびに 32 バイトの乱数で作り直します。
- 環境変数は引き継がず（`clearEnv`）、[app-json.md](app-json.md) に挙げたものと、Deno が動くのに要るもの（`HOME`、`DENO_DIR`、`XDG_CACHE_HOME`、`PATH`）だけを渡します。
- `runner/runner.ts` は Station が用意します。`entry` を読み込み、`127.0.0.1:<ポート>` で待ち受け、`Ebina-App-Token` を確かめてからアプリに渡します。待ち受けを始めたら標準出力に `EBINA_READY` を 1 行出します。
- 標準出力と標準エラーは Station が行ごとに受け取り、アプリごとに最新 500 行を持ちます（アプリ管理の画面で見られるようにする）。同じ行を Station のログにも出します（標準エラーは警告。`Ebina-App-Token` と同じ文字列は `(token)` に置き換えます）。
- `EBINA_READY` が 30 秒来なければ、止めて「異常」にします（再起動はしません）。
- 落ちたら、1 秒、2 秒、4 秒、…（最大 30 秒）の間隔で再起動します。10 分のうちに 5 回落ちたら「異常」にして止めます。
- 止めるときは `SIGTERM` を送り、5 秒待っても終わらなければ `SIGKILL` します。
- Station が止まるときは、子プロセスもすべて止めます。Station が突然いなくなっても、runner は 2 秒ごとに親の有無を見て、自分で終わります。

## 外部アプリ

- 使用者が自分で起動し、アプリ管理の画面から名前と URL を登録します。
- Station は登録のときに `Ebina-App-Token` を発行して表示します。アプリはそれを設定して、一致しないリクエストを拒否します。
- 起動と停止は Station の管理の外です。状態は、中継したときに応答があったかどうかで表示します。

## アプリ

アプリごとの仕様は `docs/apps/<アプリ名>.md` に書きます。

| アプリ名 | 内容 | 仕様 |
| --- | --- | --- |
| `binette-editor` | ビネットの作成・編集・削除・プレビュー（第一弾の埋め込みアプリ） | [apps/binette-editor.md](apps/binette-editor.md) |

## ユーザー

- v2.0.0 では、ユーザーを区別しません。ログインできる人は全員、すべての操作ができます。
- ユーザーの作成と登録 URL の発行は、Station の CLI で行います（v1 の `member temp regist` にあたるもの）。
- 権限やユーザー管理は、あとで「ユーザーマネージャ」のアプリとして作る想定です。そのために、アプリが Station の機能を呼ぶ API が要ります（未決）。
- ユーザー ID は 1〜64 文字の `[A-Za-z0-9._-]` です。名前は前後の空白を除いて 1〜64 文字で、改行などの制御文字は使えません。

## CLI

Station とは別のコマンドです（`deno task user <サブコマンド>`）。Station を止めずに使えます。同じ SQLite を別のプロセスで開いて読み書きします。`station.json` の `frontURL`・`serverURL` は Station と同じように読みます（`list` と `remove` は読みません）。

| サブコマンド | 内容 |
| --- | --- |
| `add <ID> <名前> [--with-code]` | ユーザーを作り、登録トークンを発行して、登録 URL・QR・確認コード・有効期限を出す |
| `token <ID> [--with-code]` | 既存のユーザーに登録トークンを発行し直す（別のパスキーを足すとき） |
| `list` | ユーザーの一覧（ID、名前、パスキーの数） |
| `remove <ID> [--yes]` | ユーザーを消す（パスキーと登録トークンも消える）。`--yes` が無ければ確認を求める |

- 登録 URL は `<frontURL>/register?server=<serverURL>&token=<トークン>` です。確認コードは既定では URL に入れず、ターミナルに別に出します。`--with-code` を付けると `&code=<確認コード>` も URL に入れます。
- 名前に空白を含むときは引用符で囲みます。
- 終了コードは、成功が 0、使い方の誤りが 2、それ以外の失敗（ユーザーが重複・不在、設定の不備、確認で中止など）が 1 です。
- 動いている Station でユーザーを消すと、そのユーザーのセッションは次のリクエストから 401 になります。

## v1 から引き継がないもの

v1 の仕様は [v1/README.md](v1/README.md) に記録してあります。

- パスワード、TOTP、JWT のログイン
- REST の `/ebina/*` の管理 API
- MongoDB
- v1 のアプリの仕組み（`apis.json` と `entrance.ts` の API サーバー、honbu の中で動く cron）。子プロセスで動かす考え方は埋め込みアプリに引き継ぐ
- docker-compose（nginx、MongoDB、certbot のコンテナ）

nginx、certbot、systemd の起動スクリプトをどうするかは未決です。

## 未決のこと

- アプリから Station を呼ぶ API（ユーザー一覧など。ユーザーマネージャに必要）
- 権限（誰がアプリ管理をできるか、アプリごとに使えるユーザーを分けるか）
- ウィジェット
- 埋め込みアプリを画面から追加する方法（アップロード、git など）。v2.0.0 は `apps/` にフォルダを置いて Station を再起動
- WAKE のセッションを再起動をまたいで残せるか（`@wake-protocol/server` が鍵を保存できる形にするまで、メモリのまま）
- nginx、certbot、systemd の扱い
- 外部アプリが Station に向けてつなぐ形（NAT の内側のアプリ向け）にするか
