# station.json

Station の設定ファイルです。`project/station.json` に置きます。Station は起動するときに 1 回だけ読みます。変えたら再起動します。

> [!WARNING]
> 下書きです。

## 例

```json
{
  "port": 3456,
  "origins": ["https://nozomi-hiragi.github.io"],
  "rpId": "nozomi-hiragi.github.io",
  "rpName": "EbinaStation",
  "frontURL": "https://nozomi-hiragi.github.io/ebina-station",
  "serverURL": "https://station.example.com",
  "entrance": {
    "redirect": "/binette-editor"
  }
}
```

## 欄

| 欄 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `port` | 数値 | ○ | Station が待ち受けるポート |
| `origins` | 文字列の配列 | ○ | クライアントの origin。CORS で許可し、WAKE のログインの origin にも使う |
| `rpId` | 文字列 | ○ | WebAuthn の RP ID。クライアントのホスト名 |
| `rpName` | 文字列 | | WebAuthn の RP 名。省略時は `"EbinaStation"` |
| `frontURL` | 文字列 | ○ | クライアントの URL。CLI が登録 URL を作るときに使う |
| `serverURL` | 文字列 | ○ | クライアントから見た Station の URL。CLI が登録 URL を作るときに使う |
| `entrance` | オブジェクト | | 入口 `/index.bina` の設定 |
| `entrance.redirect` | 文字列 | | `/` を開いたときの転送先（`/` 始まりの Scene 内のパス）。省略時は `/settings` |

- 登録 URL は `<frontURL>/register?server=<serverURL>&token=<トークン>&code=<確認コード>` です。
- パスやポートなど、Station が決め打ちで使うもの（`data/`、`apps/` の場所など）は書きません。

## 書かないもの

次のものは `station.json` ではなく、`data/station/station.db` に保存します。画面や CLI から変えるためです。

- ユーザー、パスキー、WAKE のセッション
- アプリの有効・無効、外部アプリの登録（名前、URL、`Ebina-App-Token`）
- 埋め込みアプリの `Ebina-App-Token`（起動のたびに作り直す）

## 未決のこと

- 初回起動で `station.json` が無いとき、対話で作るか、例を書き出して止まるか
- ET の本文の上限を設定できるようにするか
- 埋め込みアプリに割り当てるポートの範囲を設定できるようにするか
