# Binette エディタ（`binette-editor`）

クライアントからビネットを作り、編集し、消せる埋め込みアプリです。EbinaStation v2 の第一弾のアプリです。

> [!WARNING]
> 下書きです。

Station とアプリのあいだの決まり（中継、`Ebina-User` などのヘッダー、子プロセスの起動）は [../spec.md](../spec.md)、`app.json` は [../app-json.md](../app-json.md) を参照してください。

## フォルダ

```
apps/binette-editor/
├── app.json
├── main.ts          # API とプレビューを返す
└── panoplie/        # 一覧・編集の画面（.bina と js）

data/apps/binette-editor/
└── binette/         # 作ったビネット（<名前>.bina）
```

`app.json`:

```json
{
  "label": "Binette エディタ",
  "version": "0.1.0",
  "description": "ビネットを作り、編集し、プレビューする",
  "icon": "📝",
  "entry": "main.ts"
}
```

## 扱うビネット

- 保存先はデータフォルダの `binette/` です（`data/apps/binette-editor/binette/<名前>.bina`）。v2.0.0 ではこの中だけを扱います。
- 名前は `/` で区切れます。`a/b` は `binette/a/b.bina` です。空の区切り、`.`、`..`、`\` は使えません（パノプリの名前と同じ）。
- 保存するときに `@binette/core` で形式を検査し、正しくなければ保存しません。
- ユーザーは区別しません。ログインできる人は全員、すべてのビネットを読み書きできます。

## 画面

画面のパスは Scene のパスです。ビネットは `panoplie/` から配ります。

| パス | 内容 |
| --- | --- |
| `/binette-editor` | 一覧。新規作成、編集、削除、プレビューへのボタン |
| `/binette-editor/edit?name=<名前>` | JSON の編集と保存。検査のエラーを表示する。プレビューボタン |
| `/binette-editor/preview/<名前>` | 保存したビネットをそのまま再生する |

- 新規作成は名前を入力し、ひな形（`entry` が html の asset 1 つ）を入れて編集画面を開きます。
- 削除は確認してから行います。
- プレビューボタンは、保存してからプレビューの画面へ移ります。保存していない変更があるときは、先に保存するか確かめます。
- プレビューは Scene がそのまま再生するので、`redirect` のビネットは転送先へ移ります。

## API

クライアントからは `/binette-editor/…` で呼びます（Station がアプリ名を取り除いて渡します）。本文は JSON です。

| メソッドとパス | 内容 |
| --- | --- |
| `GET /api/binettes` | 名前の一覧 `{ "names": ["a", "a/b"] }`（名前順） |
| `GET /api/binettes/<名前>` | 中身（ビネットの JSON） |
| `PUT /api/binettes/<名前>` | 作成・上書き。本文はビネットの JSON |
| `DELETE /api/binettes/<名前>` | 削除 |
| `GET /preview/<名前>.bina` | 保存したビネットを返す（プレビュー用） |

エラー:

| ステータス | いつ | 本文 |
| --- | --- | --- |
| 400 | 名前が正しくない、JSON が読めない、形式の検査に通らない | `{ "error": "<日本語のメッセージ>" }` |
| 404 | そのビネットが無い | `{ "error": "<日本語のメッセージ>" }` |

## 未決のこと

- 作ったビネットをプレビュー以外の場所（Station の入口や、ほかのアプリ）で公開するか
- ビネットが使うファイル（js や画像）を保存・編集できるようにするか
- 編集画面を JSON の直接編集から、フォームなどにするか
- データフォルダの外（ほかのアプリの `panoplie/` など）を編集できるようにするか
