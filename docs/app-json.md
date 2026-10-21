# app.json

埋め込みアプリの設定ファイルです。`project/apps/<アプリ名>/app.json` に置きます。このファイルがあるフォルダだけを、Station はアプリとして扱います。アプリ名はフォルダ名で決まるので、`app.json` には書きません。

Station は起動したときと、アプリ管理の画面で再読み込みしたときに読みます。

> [!WARNING]
> 下書きです。

## 例

```json
{
  "label": "Binette エディタ",
  "icon": "📝",
  "entry": "main.ts"
}
```

静的なアプリ（`panoplie/` だけ）なら、`entry` を書きません。

```json
{
  "label": "お知らせ"
}
```

## 欄

| 欄 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `label` | 文字列 | ○ | 表示名。入口の設定画面のアプリ一覧やアプリ管理の画面に出す |
| `icon` | 文字列 | | 一覧の行の先頭に出す文字（絵文字など）。設定画面の行の `start` に使う |
| `entry` | 文字列 | | 子プロセスで動かす module のパス。アプリのフォルダからの相対パスで、外へは出られない（`..` は使えない） |

- `entry` の module の default export を `fetch(req: Request) => Response | Promise<Response>` として動かします。
- `entry` と `panoplie/` のどちらも無いアプリは、異常として扱い、起動しません。
- 知らない欄は無視します。
- 形式が正しくないときは、そのアプリを異常として扱い、理由をアプリ管理の画面に出します。

## アプリのフォルダ

```
apps/<アプリ名>/
├── app.json
├── main.ts       # entry に書いたもの（任意）
└── panoplie/     # 静的な .bina とファイル（任意）
```

| `entry` | `panoplie/` | 動き |
| --- | --- | --- |
| あり | なし | 子プロセスに渡す |
| なし | あり | Station が `@binette/coulisses` で直接配る。子プロセスは起動しない |
| あり | あり | まず子プロセスに渡す。404 なら `panoplie/` から探す |

## 子プロセスに渡すもの

| 環境変数 | 内容 |
| --- | --- |
| `EBINA_PORT` | 待ち受けるポート（`127.0.0.1`） |
| `EBINA_APP_TOKEN` | Station からのリクエストを確かめる秘密 |
| `EBINA_DATA_DIR` | データフォルダ `data/apps/<アプリ名>/` の絶対パス |

待ち受けと `Ebina-App-Token` の確認は、Station が用意する `runner.ts` が行います。アプリは `fetch` を書くだけです。

## 未決のこと

- 権限を広げる欄（外部への通信など）を足すか
- `version`・`description` を足すか
- ウィジェットの宣言をここに書くか
