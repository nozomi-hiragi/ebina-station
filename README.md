# EbinaStation

EbinaStation は、クライアント（[ebina-front](https://github.com/nozomi-hiragi/ebina-front)）とアプリのあいだに立つサーバーです。パスキーでのログインとセッション（[WAKE](https://github.com/nozomi-hiragi/wake-protocol)）を受け持ち、クライアントからのリクエストをアプリへ中継します。画面はアプリが [Binette](https://github.com/nozomi-hiragi/binette) で返します。

> [!WARNING]
> v2 として作り直し中です。今動くのは、パスキーの登録とログイン、アプリの中継（子プロセスで動く埋め込みアプリと、静的な `panoplie/`）、ユーザーを作る CLI までです。アプリ管理の画面と Binette エディタはまだありません。v1 は [`v1.1.0` のタグ](https://github.com/nozomi-hiragi/ebina-station/tree/v1.1.0) を参照してください。

## 開発の始め方

前提: [Deno](https://deno.com/) 2（2.9 で確かめています）。ebina-front と組むには Node.js 22.18 以上も要ります。

### 1. 設定を置く

設定とデータは `project/` に置きます（Git には入りません）。開発用の例をコピーします。

```sh
mkdir -p project
cp examples/station.json project/station.json
```

例は、ebina-front の `npm run dev`（`http://localhost:5173/ebina-station/`）と組む設定で、Station は `http://localhost:8787` で待ち受けます。欄の説明は [docs/station-json.md](docs/station-json.md) を参照してください。

### 2. アプリを置く（任意）

`project/apps/<アプリ名>/` にフォルダを作り、`app.json` を置くとアプリになります。たとえば、静的な画面を返すだけのアプリです。

```sh
mkdir -p project/apps/hello/panoplie
cat > project/apps/hello/app.json <<'EOF'
{ "label": "こんにちは", "icon": "👋" }
EOF
cat > project/apps/hello/panoplie/index.bina <<'EOF'
{
  "binette": "0.1",
  "title": "こんにちは",
  "entry": "main",
  "assets": { "main": { "type": "html", "content": "<p>こんにちは</p>" } }
}
EOF
```

`main.ts` を置いて `entry` に書けば、子プロセスで動くアプリになります（`export default { fetch(req) { … } }`）。詳しくは [docs/app-json.md](docs/app-json.md) を参照してください。

### 3. 起動する

```sh
deno task dev     # ファイルを変えると再起動する
deno task start   # 普通に起動する
```

止めるときは Ctrl-C です。アプリを足したり `app.json` を変えたりしたら、再起動します。Station を再起動すると、ログイン中のセッションは無効になり、ログインし直しになります。

### 4. ユーザーを作る

別のターミナルで、ユーザーを作ります。Station を止める必要はありません。

```sh
deno task user add alice "Alice"
```

パスキーを登録する URL、QR コード、4 桁の確認コード、有効期限が出ます。URL は 15 分以内に 1 回だけ使えます。確認コードも URL に含めるには `--with-code` を付けます。

| コマンド | 内容 |
| --- | --- |
| `deno task user add <ID> <名前> [--with-code]` | ユーザーを作り、登録 URL を出す |
| `deno task user token <ID> [--with-code]` | 登録 URL を発行し直す（別のパスキーを足すとき） |
| `deno task user list` | ユーザーの一覧 |
| `deno task user remove <ID> [--yes]` | ユーザーを消す |

### 5. ebina-front と組む

```sh
git clone https://github.com/nozomi-hiragi/ebina-front
cd ebina-front
git checkout v2.0.0
npm install
npm run dev       # http://localhost:5173/ebina-station/
```

`npm run dev:server`（ebina-front 同梱のテスト用サーバー）は同じポート 8787 を使うので、起動しません。

1. 手順 4 で出た登録 URL をブラウザで開きます
2. 確認コードを入力し、画面の指示に従ってパスキーを登録します
3. 「ログインへ」を押して、パスキーでログインします
4. ログインすると、有効なアプリの一覧が出ます

### project の場所を変える

環境変数 `EBINA_PROJECT_DIR` で `project/` の場所を変えられます。ただし `deno task` が書き込めるのは `./project` だけなので、別の場所を使うときは権限を指定して直接起動します。

```sh
export EBINA_PROJECT_DIR=/var/lib/ebina
deno run --allow-net --allow-read --allow-write=$EBINA_PROJECT_DIR --allow-env --allow-run src/main.ts
deno run --allow-read --allow-write=$EBINA_PROJECT_DIR --allow-env src/cli/main.ts add alice "Alice"
```

## 検査とテスト

```sh
deno task check   # deno fmt --check、deno lint、deno check
deno task test    # deno test
```

テストは、ソフトウェアのパスキーで登録からログイン、アプリの中継までを通します。アプリの子プロセスを実際に起動するので、全体で十秒ほどかかります。

## ドキュメント

- [v2 の仕様（下書き）](docs/spec.md)
  - [station.json](docs/station-json.md)
  - [app.json](docs/app-json.md)
  - アプリ: [Binette エディタ](docs/apps/binette-editor.md)
- [v1 の仕様の記録](docs/v1/README.md)
  - [WebAuthn](docs/v1/webauthn.md)
  - [保存データ](docs/v1/data.md)

## ライセンス

[LICENSE](LICENSE) を参照してください。
