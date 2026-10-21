# EbinaStation v1 の保存データ

v1.1.0（`main`）が保存しているファイルの形の記録です。概要は [README.md](README.md)、WebAuthn は [webauthn.md](webauthn.md) を参照してください。

Station のデータはすべて `project/` の JSON ファイルです。データベース（MongoDB）には入れません。ファイルは起動時に読み、変更のたびに全体を書き直します。

## フォルダ

```
project/
├── settings.json        # 設定
├── members.json         # メンバーと仮メンバー
├── apps/
│   ├── ports.json       # アプリ名 → ポート
│   └── <アプリ名>/
│       ├── apis.json    # API の定義
│       ├── cron.json    # cron の定義
│       └── scripts/     # スクリプト（entrance.ts をコピーして置く）
├── gomi/                # 消したアプリの移動先（<アプリ名>_<日時>）
├── nginx/
│   ├── nginx.conf
│   ├── confs.json       # ルートの定義
│   ├── generate/        # confs.json から作る .conf
│   └── sites-enabled/   # 手で置く設定
└── letsencrypt/         # certbot の証明書と webroot
```

## settings.json

| 欄 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `port` | 数値か `"env"` | `3456` | 待ち受けるポート。`"env"` なら環境変数 `PORT` |
| `origins` | 文字列の配列 | `["https://nozomi-hiragi.github.io", "http://localhost:3000"]` | CORS で許す origin |
| `Member.allowRegist` | 真偽値 | `true` | 新しいメンバーの登録を許すか |
| `Member.maxMembers` | 数値 | `1` | メンバーと仮メンバーを合わせた上限 |
| `WebAuthn.rpName` | 文字列 | `"EbinaStation"` | RP 名 |
| `WebAuthn.rpIDType` | `"variable"` か `"static"` | `"variable"` | `variable` はリクエストの origin のホスト名を RP ID にする。`static` は `rpID` を使う |
| `WebAuthn.rpID` | 文字列 | | `static` のときの RP ID |
| `WebAuthn.attestationType` | 文字列 | | attestation の指定 |
| `Mongodb.port` | 数値 | `27017` | MongoDB のポート |
| `Mongodb.username` / `password` | 文字列か `"env"` | `"env"` | `"env"` なら `.env` の値 |
| `Mongodb.databaseFilter` | オブジェクト | `admin`・`config`・`local` を隠す | `{ <DB 名>: { enable } }`。`enable: true` の DB は一覧から隠し、中も見せない |
| `WebPush.publicKey` / `privateKey` | 文字列 | 初回に作る | VAPID の鍵 |
| `WebPush.contactInfo` | 文字列 | | VAPID の `sub`。無ければリクエストの origin |

初回の対話では、次の順に聞きます。

1. Let's Encrypt の利用規約に同意するか。同意しなければ止まる
2. origin を足すか
3. `rpName`


## members.json

メンバーと仮メンバーを 1 つのファイルに入れます。変更のたびにファイル全体を書き直します（`JSON.stringify(…, undefined, 2)`）。

```ts
// project/members.json
interface MembersValues {
  members: { [id: string]: MemberValues };
  temp?: { [id: string]: { from: string; member: MemberValues } }; // 仮メンバーがいないときは書かない
}

interface MemberValues {
  name: string;
  auth: {
    password?: { hash: string };           // bcrypt のハッシュ
    totpAuth?: { secret: string };         // TOTP の秘密（base32）
    webAuthn?: {                           // RP ID ごと。認証器が 1 つも無ければ RP ID ごと消す
      [rpId: string]: {
        authenticators: { [deviceName: string]: WebAuthnAuthenticator };
        enableDevices: string[];           // ログインに使うデバイス名
      };
    };
  };
  webpush?: {
    devices: { [deviceName: string]: { subscription: PushSubscriptionJSON } };
  };
  flags?: { admin?: boolean };
}
```

`WebAuthnAuthenticator` の形は [webauthn.md](webauthn.md#保存する認証器) を参照してください。

例:

```json
{
  "members": {
    "nozomi": {
      "name": "のぞみ",
      "auth": {
        "password": { "hash": "$2a$10$…" },
        "totpAuth": { "secret": "JBSWY3DPEHPK3PXP…" },
        "webAuthn": {
          "nozomi-hiragi.github.io": {
            "authenticators": {
              "FirstDevice": {
                "fmt": "none",
                "counter": 0,
                "aaguid": "AAAAAAAAAAAAAAAAAAAAAA",
                "credentialID": "kTq3…",
                "credentialPublicKey": "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n",
                "credentialType": "public-key",
                "transports": ["internal", "hybrid"]
              }
            },
            "enableDevices": ["FirstDevice"]
          }
        }
      },
      "webpush": {
        "devices": {
          "iPhone": {
            "subscription": {
              "endpoint": "https://web.push.apple.com/…",
              "expirationTime": null,
              "keys": { "p256dh": "BN…", "auth": "Xy…" }
            }
          }
        }
      },
      "flags": { "admin": true }
    }
  },
  "temp": {
    "guest": {
      "from": "console",
      "member": { "name": "ゲスト", "auth": { "password": { "hash": "$2a$10$…" } } }
    }
  }
}
```

**メンバー ID**

- `members` と `temp` のキーです。中の値には ID を持ちません。
- 文字の制限はありません。登録画面で入れたものをそのまま使います。
- WebAuthn の `user.id`（userHandle）にも、ID の UTF-8 のバイト列をそのまま使います（[webauthn.md](webauthn.md#エンコード)）。

**パスワード**

- bcrypt（deno.land/x/bcrypt v0.4.1 の `hashSync`、既定のコスト）です。
- 仮登録のときに必ず作ります。

**TOTP**

- otpauth v9 の既定（SHA1、6 桁、30 秒、前後 1 つまで許す）です。発行者は `EbinaStation`、ラベルはメンバーの名前です。
- `POST /i/totp/request` で作った仮の秘密はメモリだけに持ちます。`POST /i/totp/regist` でコードが合ったら `totpAuth` に入れます。

**WebPush**

- `subscription` はブラウザの `PushSubscription.toJSON()` の形です。`endpoint`、`keys.p256dh`、`keys.auth` が必須です。
- デバイス名はクライアントが決めます。

**flags**

- `admin: false` は書きません。
- 保存はしますが、権限の判定には使っていません。

**クライアントに返す形**

`GET /i`・`GET /member` などは、`auth` と `webpush` を除いて返します。

```json
{ "id": "nozomi", "name": "のぞみ", "flags": { "admin": true } }
```

`GET /i` には `id` が入りません（`name` と `flags` だけ）。`GET /member/member/:id` は `Member` のインスタンスを展開して JSON にするので、`id` と `value` がそのまま出ます。`value` には `auth` が入っているため、パスワードのハッシュ・TOTP の秘密・認証器の情報も返してしまいます（v1 の不具合）。


## アプリ（apps/<アプリ名>/）

v1 のアプリは「API をまとめた HTTP サーバー」と「cron」の組です。

**apis.json**（バージョン 2。バージョン 1 は読むときに移行）

```json
{
  "version": 2,
  "init": { "filename": "init.ts", "function": "init" },
  "final": { "filename": "final.ts", "function": "final" },
  "apis": [
    { "name": "hello", "path": "hello", "method": "get", "value": "こんにちは" },
    { "name": "users", "path": "users/:id", "method": "get", "filename": "users.ts", "value": "getUser" }
  ]
}
```

- `filename` が無い API は `value` の文字列をそのまま返します。
- `filename` があれば、`scripts/<filename>` の export `value` を oak のハンドラーとして使います。
- `init(app, router, port)` は待ち受けの前に、`final(app)` は終わるときに呼ばれます。

**API の起動**: アプリ管理の画面から起動すると、honbu が次のコマンドを実行します。

```
deno run --allow-net --allow-read=project/apps/<アプリ名> project/apps/<アプリ名>/scripts/entrance.ts <引数の JSON>
```

- `entrance.ts` が `apis.json` を読み、ルーターを作り、`ports.json` のポートで待ち受けます。
- 起動の状態は honbu のメモリだけにあり、honbu を再起動すると止まったままになります。
- クライアントからアプリの API へは、nginx のルートで届けます。Station は中継しません。

**ports.json**: アプリ名 → ポート。`15346` より上の空いている番号を割り当てます。

**cron.json**

```json
{ "<cron 名>": { "enable": true, "pattern": "0 * * * *", "function": "job.ts>run" } }
```

- `function` は `<ファイル名>><関数名>` です。
- honbu の中で `scripts/<ファイル名>` を import して、croner で実行します。子プロセスではありません。
- 戻り値をログに出します。

**作成と削除**:
- 作成はフォルダを作るだけです。アプリが 1 つも無いときは `FirstApp` を作ります。
- 削除は `gomi/` への移動です。
- 名前の変更はフォルダの名前を変えます。大文字・小文字の違いだけの名前は重複として扱います。

## nginx（Jinji）

**confs.json**: ルート名 → 次の形の値です。

| 欄 | 説明 |
| --- | --- |
| `hostname` | `server_name` |
| `port` | 転送先のポート。`"koujou"` なら honbu のポート |
| `ssl` | 証明書のパス（`certificate`、`certificateKey`、`trustedCertificate`、`dhparam`） |
| `certbot` | `true` なら Let's Encrypt の証明書のパスを使う |
| `certWebRoot` | `/.well-known/` を `/var/www/html` から返す（certbot の webroot 用） |
| `resolver` | Cloudflare の DNS を `resolver` に入れる |

- `generate/<ルート名>.conf` を作ります。80 番で受けて `proxy_pass http://localhost:<port>/` します。`ssl` があれば 443 番も受けます。
- コンテナは Docker Desktop ならポートの公開（80・443）で、それ以外は `network_mode: host` で動かします。


## メモリだけに持つもの

次のものはファイルに保存しません。Station を再起動すると消えます。

| もの | 場所 | 中身 | 期限 |
| --- | --- | --- | --- |
| JWT の署名の鍵 | `auth_manager/token.ts` | 起動時に作る HMAC の鍵 | 再起動まで（再起動で全員ログアウト） |
| 登録トークン | `Members.preRquests` | `token → { from, date }` | 30 分。1 回だけ使える。期限切れは次の発行のときに掃除 |
| 登録中のチャレンジ | `Member.challengeWebAuthn` | `{ name: デバイス名, challenge }` | 次の登録で上書き |
| 認証中のチャレンジと操作 | `AuthChallenge.challenges` | `key → { challenge, createdAt, action? }` | 使うと消える。期限は見ていない |
| 仮の TOTP | `Member.tempTOTP` | `{ secret }` | 登録するまで |
| アプリの API の子プロセス | `ebinaAPI/app/api.ts` | `appName → { entranceProc, startedDate }` | 再起動で止まったまま |

認証中のチャレンジのキーは [webauthn.md](webauthn.md#チャレンジの控え) を参照してください。
