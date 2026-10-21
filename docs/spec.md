# EbinaStation v2 仕様（下書き）

EbinaStation v2 は、クライアント（ebina-front）とアプリのあいだに立つ中継役です。ログインとセッションを受け持ち、クライアントからのリクエストをアプリへ渡し、アプリの応答を返します。業務の画面はアプリが Binette で返します。

> [!WARNING]
> 下書きです。「未決のこと」に挙げた点は、まだ決まっていません。

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

- Deno 2（アプリの子プロセスを Deno の権限指定で閉じ込めるため）
- Hono、`@wake-protocol/server`、`@binette/coulisses`（npm から使う）
- 保存: SQLite（`data/station/station.db`）。WAKE のストアは複数の値をまとめて書き換える操作が多いため、トランザクションが使えるものにする。保存方法の詳細はあとで決める

## クライアントとの契約

ebina-front v2.0.0 の `src/api/station.ts` と `dev-server/app.ts` が今の契約です。変えるときは ebina-front と合わせて変えます。

### WAKE の外（登録）

| メソッドとパス | 内容 |
| --- | --- |
| `GET /ebina/register/info?token=` | 登録トークンのユーザー `{ id, name }` |
| `POST /ebina/register/options` | `{ token, code }` を受け、WebAuthn の登録オプションを返す。確認コードは 5 回まで |
| `POST /ebina/register/verify` | `{ token, response }` を受け、パスキーを保存する |

- パスキーは ES256 だけ、`residentKey: required`、`userVerification: required` にします。
- 登録トークンは 15 分で切れ、1 回だけ使えます。確認コードは 4 桁です。
- エラーは `{ "error": "<日本語のメッセージ>" }` です。

### WAKE

- `/ebina/auth/*` と `/ebina/wake/*` は、`/ebina` を取り除いて WAKE サーバーの `handle()` に渡します。
- CORS は `station.json` の `origins` だけを許します（[station-json.md](station-json.md)）。

### ET の URL

ET で運ぶ URL は `wake://station/…` で表します。

| URL | 行き先 |
| --- | --- |
| `wake://station/me` | Station。ログイン中のユーザー `{ id, name }` |
| `wake://station/index.bina` | Station の入口 |
| `wake://station/station/…` | Station の組み込み（アプリ管理など） |
| `wake://station/<アプリ名>.bina` | アプリの `/index.bina` |
| `wake://station/<アプリ名>/…` | アプリの `/…` |
| それ以外 | 404 `{"error":{"code":"not_found"}}` |

Scene はパス `/<アプリ名>/a/b` から `wake://station/<アプリ名>/a/b.bina` を取ります。asset の `src` や `sh.fetch` も同じ規則で解決するので、アプリが返す URL は `/<アプリ名>/…` で書きます。これで、Binette の仕様で未決の「ビネットがどのアプリのものか」を、パスの先頭で決めることにします。

## 入口と組み込みの画面

### 入口（`/index.bina`）

Station が作ります。

- `settings` に、有効なアプリの一覧（`type: "list"`、行を押すとそのアプリの `/` へ）、「アプリ管理」の行、ログアウト（`component: "logout"`）を並べます。
- 入口の行き先は `station.json` の `entrance.redirect` で指定できます。指定が無ければ `/settings` へ転送します。

### アプリ管理（`/station/apps`）

Station 組み込みのビネット（js の画面）です。操作は次のとおりです。

- 一覧: 名前、種類（埋め込み / 外部）、状態（停止 / 起動中 / 異常）
- 再読み込み: `apps/` を読み直し、増えたアプリを一覧に足す
- 有効・無効の切り替え、再起動、ログの表示（埋め込みのみ）
- 外部アプリの登録・登録解除（名前、URL）

画面から呼ぶ API は `wake://station/station/api/…` に置き、JSON で返します。v2.0.0 ではログインしたユーザーは誰でも使えます。

## アプリへの中継

### 振り分け

1. ET の URL の最初の区切りをアプリ名とします（`wake://station/<アプリ名>/…`）。
2. アプリ名の部分を取り除き、残りをアプリへのパスにします。`<アプリ名>.bina` は `/index.bina` にします。
3. 無効なアプリや存在しないアプリは 404、停止中や応答が無いアプリは 502 を返します。

### アプリに渡すもの

- メソッド、パス、クエリ、本文はそのまま渡します。
- クライアントが送った `Ebina-` で始まるヘッダーは捨て、Station が次のヘッダーを付けます。

| ヘッダー | 内容 |
| --- | --- |
| `Ebina-User` | ログイン中のユーザー ID |
| `Ebina-App-Token` | Station とそのアプリだけが知っている秘密。アプリは一致しないリクエストを拒否する |

- 応答のステータス、ヘッダー（`content-type` など）、本文をそのまま返します。ET は本文をまとめて運ぶため、大きさには上限を設けます（値は未決）。

### アプリ名

- 英小文字、数字、`-` だけで、英小文字で始めます。`apps/` のフォルダ名がそのままアプリ名です。
- 予約名（`index`、`settings`、`station`、`me`、`ebina`）は使えません。

## 埋め込みアプリ

### フォルダ

```
project/
├── station.json
├── data/
│   ├── station/station.db     # ユーザー、パスキー、WAKE のセッション、アプリの登録
│   └── apps/<アプリ名>/        # アプリごとのデータフォルダ
└── apps/<アプリ名>/
    ├── app.json
    ├── main.ts                # 任意
    └── panoplie/              # 任意。静的な .bina とファイル
```

- `station.json` の欄は [station-json.md](station-json.md) を参照
- `app.json` の欄と、`entry`・`panoplie/` の動きは [app-json.md](app-json.md) を参照

### 起動

Station は有効な埋め込みアプリごとに、子プロセスを 1 つ起動します。

```
deno run \
  --allow-net=127.0.0.1:<ポート> \
  --allow-read=apps/<アプリ名>,data/apps/<アプリ名> \
  --allow-write=data/apps/<アプリ名> \
  runner.ts
```

- `runner.ts` は Station が用意します。`entry` を読み込み、`127.0.0.1:<ポート>` で待ち受け、`Ebina-App-Token` を確かめてからアプリに渡します。渡す環境変数は [app-json.md](app-json.md) を参照。
- 標準出力と標準エラーは Station が受け取り、アプリ管理の画面で見られるようにします。
- 落ちたら、間隔を延ばしながら再起動します。続けて失敗したら「異常」にして止めます。
- Station が止まるときは、子プロセスもすべて止めます。

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
- 埋め込みアプリを画面から追加する方法（アップロード、git など）。v2.0.0 は `apps/` にフォルダを置いて再読み込み
- ET の本文の上限
- nginx、certbot、systemd の扱い
- 外部アプリが Station に向けてつなぐ形（NAT の内側のアプリ向け）にするか
