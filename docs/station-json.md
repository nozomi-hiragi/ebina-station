# station.json

Station の設定ファイルです。`project/station.json` に置きます。Station は起動するときに 1 回だけ読みます。変えたら再起動します。開発用の例は [`examples/station.json`](../examples/station.json) にあります（ebina-front の `npm run dev` と組む設定です）。

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
| `port` | 数値 | ○ | Station が待ち受けるポート（1〜65535 の整数）。すべてのインターフェースで待ち受ける |
| `origins` | 文字列の配列 | ○ | クライアントの origin。CORS で許可し、WAKE のログインの origin にも使う |
| `rpId` | 文字列 | ○ | WebAuthn の RP ID。クライアントのホスト名 |
| `rpName` | 文字列 | | WebAuthn の RP 名。省略時は `"EbinaStation"` |
| `frontURL` | 文字列 | ○ | クライアントの URL。CLI が登録 URL を作るときに使う |
| `serverURL` | 文字列 | ○ | クライアントから見た Station の URL。CLI が登録 URL を作るときに使う |
| `entrance` | オブジェクト | | 入口 `/index.bina` の設定 |
| `entrance.redirect` | 文字列 | | `/` を開いたときの転送先（`/` 始まりの Scene 内のパス。`/` と `/index` は不可）。省略時は、有効なアプリを並べた画面を返す |

- 登録 URL は `<frontURL>/register?server=<serverURL を URL エンコードしたもの>&token=<トークン>` です。CLI に `--with-code` を付けると `&code=<確認コード>` も入ります。
- パスやポートなど、Station が決め打ちで使うもの（`data/`、`apps/` の場所など）は書きません。`project/` の場所だけは、環境変数 `EBINA_PROJECT_DIR`（省略時は `./project`）で決めます。
- 知らない欄は無視します。

## 検査

起動のときと CLI（`add`・`token`）が読むときに、次のとおり検査します。正しくなければ、どの欄が悪いかを日本語で出して、Station は起動しません（終了コード 1）。

| 欄 | 規則 |
| --- | --- |
| `port` | 1〜65535 の整数 |
| `origins` | 1 つ以上。`https://` の origin（`http://` はブラウザが WebAuthn を使わせる `localhost`・`*.localhost` だけ）。ホストが IPv4・IPv6 のものは、http でも https でも不可（WebAuthn の RP ID は IP にできない）。パス・クエリ・ユーザー情報は不可（末尾の `/` だけは可）。大文字小文字や既定ポートの書き方は正規化し、重複は除く |
| `rpId` | 小文字のホスト名だけ（`https://`・ポート・パスは不可）。IPv4 の形（数字とドットだけ）は不可。`localhost`・`*.localhost` 以外は、ドットを 1 つ以上含むこと（`com` のような 1 ラベルを除く）。すべての `origins` のホスト名が、`rpId` と同じか、その配下のサブドメインであること（WebAuthn の条件） |
| `rpName` | 空でない文字列。前後の空白は除く |
| `frontURL`、`serverURL` | `http://` か `https://` の URL。ユーザー情報・クエリ・`#` は不可。末尾の `/` は除いて使う。`frontURL` の origin が `origins` に含まれること。`frontURL` が `https://` のとき、`serverURL` の `http://` は `localhost`・`*.localhost` だけ（ブラウザの混在コンテンツの規則で、それ以外の http の Station へは届かない） |
| `entrance.redirect` | `/` で始まる。`//` 始まり、`\`、空白や制御文字は不可。クエリと `#` を除き、`.`・`..` を解決して `%` を戻したパスが `/` か `/index` になるもの（`/?tab=1`、`/#top`、`/index?x`、`/a/..` など）は、入口に戻り続けるので不可 |

公開サフィックス（`github.io`、`com` など、ドメインを登録できない名前）の一覧は持ちません。`rpId` がそうだったときは、ブラウザがパスキーの登録のときに拒みます。

## ファイルが無いとき

`station.json` が無い、読めない、JSON として読めないときは、ファイルのパスと理由を出して終了コード 1 で終わります。無いときは `examples/station.json` を案内します。Station は対話で作りません。例をコピーして、自分の環境に合わせて書き換えます。

```sh
mkdir -p project
cp examples/station.json project/station.json
```

## 埋め込みアプリのポート

埋め込みアプリが待ち受けるポートは、`station.json` には書きません。起動のたびに、Station が OS に空きを選ばせて割り当てます（`127.0.0.1` だけで待ち受けます）。

## 書かないもの

次のものは `station.json` ではなく、`data/station/station.db` に保存します。画面や CLI から変えるためです。

- ユーザー、パスキー、登録トークン
- アプリの有効・無効、外部アプリの登録（名前、URL、`Ebina-App-Token`）
- WAKE の secret

WAKE のセッションと、埋め込みアプリの `Ebina-App-Token`（起動のたびに作り直す）は、保存せずメモリに置きます。

## 未決のこと

- ET の本文の上限（今は 1 MiB 固定）を設定できるようにするか
