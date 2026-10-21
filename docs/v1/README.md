# EbinaStation v1 の仕様（記録）

v1.1.0（`main`）のコードから起こした、v1 の仕様の記録です。v2 では使いませんが、機能を作り直すときの参考に残します。

- 対象: `main`（タグ `v1.1.0`）。`v1.2.0` ブランチは oak から Hono への載せ替えと、依存のインポートマップ（`deno.json`）への移動が中心で、API のパスと動きは同じです（違いは末尾）。
- クライアントは ebina-front v1（React）です。

## 全体像

```
クライアント（ebina-front v1） ──REST /ebina/*──▶ honbu（Deno, oak）
                                                  ├ project/ の JSON ファイル（設定、メンバー、アプリ）
                                                  ├ アプリの API: entrance.ts を子プロセスで起動（アプリごとにポート）
                                                  ├ アプリの cron: honbu の中で import して実行
                                                  └ docker-compose: nginx（Jinji）、MongoDB、certbot
```

- 本体は `honbu/main.ts` から `Service` を起動します。
- 起動の順番は次のとおりです。
  1. `project/settings.json` を読む。無ければ対話で作る
  2. メンバーとアプリを読む
  3. `docker-compose.yml` を作り直し、MongoDB と nginx のコンテナを起動する
  4. 標準入力の CLI を始める
  5. `/ebina` で待ち受ける
- certbot の更新を cron（`0 0 22-28 * 1`）で回します。
- `SIGTERM` か CLI の `q` で終わります。終わるときに nginx のコンテナを消します。

## 技術スタック

- Deno（`Deno.run` を使う 1.x）、oak v11、deno.land/x の固定版（`honbu/deps.ts`）
- 認証: djwt（HS512）、bcrypt、otpauth（TOTP）、fido2-lib（WebAuthn）
- 保存: `project/` の JSON ファイル。MongoDB はアプリが使うための DB で、Station 自身のデータは入れない
- docker-compose: nginx（`EbinaStationJinji`）、mongo（`EbinaStationDB`）、certbot/certbot
- WebPush は自前の実装（`honbu/webpush/`。VAPID と aes128gcm の暗号化）

## 起動まわり

| ファイル | 内容 |
| --- | --- |
| `initEbinaStation.sh` | docker・docker-compose・deno があるか確かめる。deno の PATH を入れた `generate/startEbinaStation.sh` と、systemd の `generate/ebina-station.service` を作り、`/etc/systemd/system` にリンクする |
| `startEbinaStation.sh` | `deno run` で `honbu/main.ts` を起動する。権限は `--allow-env --allow-run --allow-net`、読み取りは `project`・`logs`・`sh`・`.env`・`nginx.conf.base`・`entrance.ts`・`dhparam.pem`、書き込みは `project`・`logs`・`docker-compose.yml` |
| `ebina-station.service.base` | systemd のユニットのひな形（`Restart=on-failure`） |
| `nginx.conf.base` | nginx の設定のひな形。`project/nginx/nginx.conf` にコピーし、`/etc/nginx/generate/*.conf` を読み込む |
| `.env` | `MONGO_INITDB_ROOT_USERNAME`、`MONGO_INITDB_ROOT_PASSWORD`。MongoDB のコンテナと、honbu の DB 接続に使う |

ログは `logs/ebina.log`（INFO 以上）と標準出力に出します。nginx のログは `logs/nginx/` です。

## project フォルダと保存データ

フォルダの構成と、保存しているファイル（`settings.json`、`members.json`、アプリ、nginx）の形は [data.md](data.md) にまとめてあります。

## WebAuthn

登録・認証の流れ、オプションの値、保存する認証器の形、エンコードの決まりは [webauthn.md](webauthn.md) にまとめてあります。

## API（`/ebina/*`）

- 認証が要る API は `Authorization: Bearer <JWT>` を付けます。
  - JWT は HS512 で、12 時間で切れます。中身は `{ id }` です。
  - 署名の鍵は起動のたびに作るので、再起動すると全員ログアウトします。
- WebAuthn の API は `Origin` ヘッダーが必須で、そこから RP ID を決めます。
- 本文は JSON です。エラーはステータスコードだけで返すものが多いです。

### WebAuthn を挟む操作

大事な操作は、内容を送ると `202` と assertion のオプションが返り、assertion の結果を同じパスに送ると実行される 2 段階です。対象の操作とチャレンジの控え方は [webauthn.md](webauthn.md#webauthn-を挟む操作) を参照してください。

### エラーの対応（AuthManager）

| エラー | ステータス |
| --- | --- |
| No member、No pre request | 404 |
| Failed auth | 403 |
| No password auth、No WebAuthn auth、No TOTP auth | 405 |
| WebAuthn Enabled、Wrong rpId | 406 |
| No matching session id | 400 |
| Already used device name、Already used id | 409 |
| それ以外 | 500 |

### 自分（`/ebina/i`）

| メソッドとパス | 認証 | 内容 |
| --- | --- | --- |
| `GET /i` | ○ | 自分のメンバー情報（`auth`・`webpush` を除く） |
| `POST /i/login/option` | | `{ id? }` → `202 { type: "WebAuthn", options, sessionId }`。`id` があればそのメンバーの有効なデバイスに絞る |
| `POST /i/login/verify` | | `{ sessionId, result }` → `200` で JWT の文字列。ID は `userHandle`（無ければ `id` ヘッダー） |
| `POST /i/logout` | ○ | `200` を返すだけ（トークンは消さない） |
| `POST /i/verify` | ○ | トークンを確かめ、ペイロードを返す |
| `PUT /i/password` | ○ | `{ current, to }` → WebAuthn を挟んでパスワードを変える。今のパスワードが違えば、assertion が通っても変えずに `422` を返す |
| `POST /i/password` | ○ | `{ code, to }` → TOTP のコードと WebAuthn でパスワードを変える（リセット） |
| `POST /i/totp/request` | ○ | 仮の TOTP を作り、`otpauth://` の URI を返す |
| `POST /i/totp/regist` | ○ | `{ pass, code }` → 仮の TOTP を確かめて登録する。WebAuthn があればパスワードと WebAuthn も要る |

### WebAuthn（`/ebina/i/webauthn`）

| メソッドとパス | 認証 | 内容 |
| --- | --- | --- |
| `POST /webauthn/regist` | 任意 | 1 回目: `{ deviceName?, pass, code }` → パスワードと TOTP を確かめ、`202` で登録のオプションを返す。2 回目: attestation の結果 → 登録し、有効なデバイス名の一覧を返す。ログインしていなければ `id` ヘッダーでメンバーを指定する |
| `POST /webauthn/verify` | ○ | `{ deviceNames }` → そのデバイスで assertion を求める（デバイスが使えるかの確認） |
| `GET /webauthn/device?deviceNames=` | ○ | デバイス名の一覧（指定があれば絞る） |
| `GET /webauthn/device/:deviceName` | ○ | そのデバイスがあるか |
| `POST /webauthn/device/:deviceName/delete` | ○ | 消す。WebAuthn を挟むか、`{ type: "password", pass, code }` で消す |
| `GET /webauthn/device/:deviceName/enable` | ○ | ログインに使うか |
| `POST /webauthn/device/:deviceName/enable` / `disable` | ○ | ログインに使う・使わないを切り替える。変わらなければ `208` |

### WebPush（`/ebina/i/webpush`）

| メソッドとパス | 内容 |
| --- | --- |
| `GET /webpush/subscribed/:name` | 登録済みか。未登録なら VAPID の公開鍵も返す |
| `POST /webpush/device` | `{ deviceName, subscription }` を保存する（新規 `201`、上書き `200`） |
| `DELETE /webpush/device/:name` | 「このデバイスを外します」の通知を送ってから消す |
| `GET /webpush/devices` | デバイス名の一覧 |
| `POST /webpush/test` | `{ deviceName }` にテストの通知を送る |

通知を送る API はクライアント向けにはこれだけで、アプリから通知を送る仕組みはありません。

### メンバー（`/ebina/member`）

| メソッドとパス | 認証 | 内容 |
| --- | --- | --- |
| `POST /member/regist/request` | ○ | `{ front?, server?, id?, name? }` → 登録トークンと登録 URL（`<front>/regist?t=&s=&i=&n=`）。上限なら `409` |
| `POST /member/regist/option` | | `{ token, id, name, pass }` → 仮メンバーを作り、WebAuthn の登録オプションを返す |
| `POST /member/regist/verify` | | `{ id, result }` → 仮メンバーにパスキーを付ける |
| `GET /member?ids=` | ○ | メンバーの一覧（指定があれば絞る） |
| `DELETE /member?ids=` | ○ | メンバーを消す（自分は消せない）。一部だけなら `206` |
| `GET /member/member/:id` | ○ | 1 人の情報 |
| `GET /member/temp` | ○ | 仮メンバーの一覧 |
| `POST /member/temp/admit` / `deny` | ○ | `{ ids }` → WebAuthn を挟んで仮メンバーを本メンバーにする・消す |

登録の流れ:

1. 登録トークンを発行する（CLI か API）。30 分で切れ、1 回だけ使える
2. 登録画面で ID・名前・パスワードを入れ、パスキーを登録する。この時点では仮メンバー
3. 既存のメンバー（CLI か API）が承認すると、本メンバーになる

### 設定（`/ebina/settings`）

| メソッドとパス | 内容 |
| --- | --- |
| `GET /settings/webauthn` | WebAuthn の設定 |
| `POST /settings/webauthn` | `rpName`・`rpIDType`・`rpID`・`attestationType` を変えて保存する |
| `GET /settings/mongodb` | ポートと、ユーザー名・パスワードが `env` かどうか（値は伏せる） |

### アプリ（`/ebina/app`）

| メソッドとパス | 内容 |
| --- | --- |
| `GET /app` | アプリ名の一覧 |
| `POST /app/:appName` | 作る |
| `GET /app/:appName` | あるか（`200` / `404`） |
| `DELETE /app/:appName` | `gomi/` へ移す |
| `PUT /app/:appName/name` | `{ name }` で名前を変える |
| `GET` / `PUT /app/:appName/init` | `init` の `{ filename, function }` |
| `GET` / `PUT /app/:appName/final` | `final` の `{ filename, function }` |
| `GET /app/:appName/api/status` | `{ status: "started" \| "stop", started_at }` |
| `PUT /app/:appName/api/status` | `{ status: "start" \| "stop" }`。start は止めてから起動し直す |
| `GET /app/:appName/api/endpoint` | API の一覧 |
| `GET` / `PUT` / `DELETE /app/:appName/api/endpoint/:path` | API の取得・更新（`:path` は今のパス）・削除 |
| `GET` / `PUT /app/:appName/api/port` | `/ebina/routing/port/number/:appName` へ転送（`308`。互換用） |
| `GET /app/:appName/script` | `scripts/` のファイル名の一覧 |
| `POST` / `GET` / `PATCH` / `DELETE /app/:appName/script/:path` | スクリプトの作成・取得・更新・削除（本文はテキスト。`..` は拒否） |
| `GET /app/:appName/cron` | cron 名の一覧 |
| `POST` / `GET` / `PATCH` / `DELETE /app/:appName/cron/:cronName` | cron の作成・取得・更新・削除（`{ enable, pattern, function }`） |

### データベース（`/ebina/database`）

honbu が MongoDB に root のユーザーでつなぎます。

| メソッドとパス | 内容 |
| --- | --- |
| `GET /database` | DB の一覧（`databaseFilter` で隠したものを除く） |
| `GET /database/:db` | コレクション名の一覧 |
| `GET /database/:db/:collection/find` | コレクションの全ドキュメント |
| `GET /database/user` | MongoDB のユーザーの一覧（`user`・`roles`） |
| `POST /database/user` | `{ username, password, roles }` でユーザーを作る |
| `DELETE /database/user/:username` | ユーザーを消す |

`GET /database/user` は `GET /database/:db` より後に登録しているので、実際には `:db = "user"` として扱われます。

### ルーティング（`/ebina/routing`）

| メソッドとパス | 内容 |
| --- | --- |
| `GET /routing` | ルート名の一覧 |
| `GET` / `POST` / `PUT` / `DELETE /routing/route/:route` | ルートの取得・作成（`{ hostname, port }` が必須）・更新（`hostname`・`port`）・削除 |
| `GET /routing/status` | nginx のコンテナの状態（`Up`・`Exit`・`Removed` など） |
| `PUT /routing/status` | `{ status: "up" \| "restart" \| "rm" }`。どれも先に `.conf` を作り直す |
| `GET /routing/port/numbers` | `{ start, ports }` |
| `GET` / `PUT /routing/port/number/:name` | アプリのポートの取得・変更（使用中なら `409`） |

### シェルスクリプトの実行（`POST /ebina/ex`）

- `{ n, o? }` → WebAuthn を挟んで `sh/<n>.sh <o...>` を実行します。
- 実行したかどうかだけを返し、出力は返しません。

## CLI（標準入力）

| コマンド | 内容 |
| --- | --- |
| `member temp list` | 仮メンバーの一覧 |
| `member temp regist [front <URL>] [server <URL>] [id <ID>] [name <名前>]` | 登録トークンを発行し、登録 URL と QR コードを出す。`front` の既定は `https://nozomi-hiragi.github.io/ebina-station` |
| `member temp admit <ID>` / `deny <ID>` | 仮メンバーを本メンバーにする・消す |
| `certbot certonly -d <ドメイン> [-m <メール>]` | webroot で証明書を取る |
| `certbot renew` | 証明書を更新する |
| `route add <名前> -h <ホスト名> -p <ポート\|koujou> [-r] [-c] [-m <メール>]` | ルートを足す。`-r` で nginx を再起動、`-c` で certbot も実行して SSL にする |
| `q` | 終わる |

`route add` は名前に `add` という文字列そのものを使っています（`sc.option` を名前にしているため）。

## v1.2.0 ブランチとの違い

- oak から Hono v2 に載せ替え（本体と `entrance.ts`）。アプリの API のハンドラーも Hono の形になる
- 依存を `deno.json` のインポートマップにまとめ、`deno task dev` / `deno task honbu` を足した
- `.env.example` を足した
- スクリプトの一覧を名前順で返す
- エラーの応答を本文 `{}` 付きの JSON で返す
- 細かい不具合の修正、systemd のユニットを sudo で動かす修正

API のパスと動きは v1.1.0 と同じです。

## v2 に向けて気になっていた点

- JWT の鍵が起動ごとに変わる。ログアウトしてもトークンが残る
- チャレンジや API の起動状態がメモリだけにあり、再起動で消える
- cron のスクリプトが honbu の中で動き、権限が honbu と同じになる
- アプリの API の起動には `--allow-net` が全部付く
- 管理者の印（`flags.admin`）があるのに、権限の判定に使われていない
- `GET /member/member/:id` がパスワードのハッシュや TOTP の秘密まで返す（[data.md](data.md#membersjson)）
