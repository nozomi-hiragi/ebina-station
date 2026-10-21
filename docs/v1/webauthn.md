# EbinaStation v1 の WebAuthn

v1.1.0（`main`）の WebAuthn の扱いの記録です。保存しているファイルの全体は [data.md](data.md)、API の一覧は [README.md](README.md) を参照してください。

## 使っているもの

| 側 | ライブラリ | 場所 |
| --- | --- | --- |
| Station | fido2-lib 3.3.4（`deno.land/x/fido2`） | `honbu/webauthn/fido2Wrap.ts`（JSON との変換）、`honbu/auth_manager/webauthn.ts`（オプションと検証）、`honbu/auth_manager/mod.ts`（流れ） |
| クライアント | `@simplewebauthn/browser` ^6.2.1 | ebina-front v1 の `src/EbinaAPI/` |

クライアントは、Station が返したオプションを `startRegistration` / `startAuthentication` にそのまま渡し、結果の JSON をそのまま送り返します。

## RP ID

- RP ID はリクエストの `Origin` ヘッダーから決めます。WebAuthn を使う API は、`Origin` が無いと `400` です。
  - `settings.json` の `WebAuthn.rpIDType` が `"variable"`（既定）なら、origin のホスト名をそのまま RP ID にする
  - `"static"` なら `WebAuthn.rpID` を使う
- 認証器はメンバーの `auth.webAuthn.<RP ID>` に分けて保存します。別のホストのクライアントから使うと、別の RP ID の認証器になります。
- fido2-lib のインスタンスは RP ID ごとに 1 つ作って使い回します。

## オプションの値

`createF2L` の設定です。

| 項目 | 値 |
| --- | --- |
| `challengeSize` | 128 バイト |
| `timeout` | 60000 ミリ秒（fido2-lib の既定） |
| `cryptoParams` | `-7, -35, -36, -37, -38, -39, -257, -258, -259`（ES256/384/512、PS256/384/512、RS256/384/512） |
| `authenticatorRequireResidentKey` | `false`（`residentKey` は付けない） |
| `authenticatorUserVerification` | `"required"` |
| `attestation` | `settings.json` の `WebAuthn.attestationType`。無ければ fido2-lib の既定の `"direct"` |
| `rpName` | `settings.json` の `WebAuthn.rpName` |

検証は `factor: "either"` です。そのため、オプションでは UV を `required` にしていても、検証では UV の無い応答（UP だけ）も通ります。

## エンコード

| 値 | 形 | 説明 |
| --- | --- | --- |
| `challenge`（オプション） | base64（`+` `/` `=` を含む形） | fido2-lib の `coerceToBase64`。SimpleWebAuthn v6 はこれも読める |
| `user.id`（登録のオプション） | メンバー ID の文字列そのまま | SimpleWebAuthn v6 が UTF-8 のバイト列にして渡す。認証器の userHandle は「メンバー ID の UTF-8」になる |
| `response.userHandle`（認証の結果） | UTF-8 の文字列 | SimpleWebAuthn v6 がバイト列を UTF-8 として読む。つまりメンバー ID そのもの |
| `credentialID`（保存） | base64url | 登録の結果の `credId`。認証のときは `response.id` と文字列で比べる |
| `allowCredentials[].id`、`excludeCredentials[].id` | base64url | 保存している `credentialID` |
| `aaguid`（保存） | base64url | 16 バイト |
| `credentialPublicKey`（保存） | PEM（SPKI） | fido2-lib の `credentialPublicKeyPem` |

SimpleWebAuthn は v8 で `user.id` と `userHandle` の扱いを base64url に変えています。v1 のデータは v6 の UTF-8 の形が前提です。

## 保存する認証器

`members.json` の `auth.webAuthn.<RP ID>` の形です。

```ts
interface WebAuthnItem {
  authenticators: { [deviceName: string]: WebAuthnAuthenticator };
  enableDevices: string[]; // ログインに使うデバイス名
}

interface WebAuthnAuthenticator {
  fmt: string;                                // attestation の形式（"none"、"packed" など）
  alg?: { algName: string; hashAlg: string }; // packed・tpm のときだけ入る（例: "ECDSA_w_SHA256" / "SHA-256"）
  counter: number;                            // 署名カウンター。認証のたびに更新
  aaguid: string;                             // base64url
  credentialID: string;                       // base64url
  credentialPublicKey: string;                // PEM
  credentialType: "public-key";
  transports?: ("ble" | "internal" | "nfc" | "usb" | "cable" | "hybrid")[];
}
```

**デバイス名**

- 認証器を見分けるための、メンバーごとの名前です。WebAuthn の仕様の値ではなく、v1 が独自に付けています。
- 名前は次のように決まります。
  - 仮登録で作った最初の認証器は `FirstDevice`
  - あとから足すものは、クライアントが送った `deviceName`。無ければ base64url の 8 文字をランダムに作る
- 同じ名前はすでにあると登録できません（`409`）。この判定は登録の検証のときに行うので、ブラウザでの操作が終わってから弾かれます。

**enableDevices（ログインに使うデバイス）**

- 登録すると、自動でこの一覧に入ります。
- 一覧が空のときは、`authenticators` の最初のデバイスだけを使います。
- ログインの検証では、ここにあるデバイスの認証器だけを許します（`allowCredentials` として fido2-lib に渡す）。ID を入れないログインでも同じです。
- 認証器を消すと、この一覧からも消えます。
- 認証器が 1 つも無くなると、その RP ID の項目ごと消えます。

## 登録

### 仮メンバーの登録（パスキーを作る）

1. 登録トークンを発行する（CLI の `member temp regist` か `POST /member/regist/request`）。
2. `POST /member/regist/option`（`{ token, id, name, pass }`）
   - トークンを消費し、パスワードを持つ仮メンバーを作って `members.json` の `temp` に保存する
   - 登録のオプションを返す。デバイス名は `FirstDevice`
3. ブラウザで `startRegistration`。
4. `POST /member/regist/verify`（`{ id, result }`）
   - 仮メンバーのチャレンジで検証し、認証器を足して保存する
5. 既存のメンバーが仮メンバーを承認すると、本メンバーになる。

### デバイスを足す（`POST /i/webauthn/regist`）

1. 1 回目は `{ deviceName?, pass, code }` を送る。
   - パスワードと TOTP の両方が合えば、登録のオプションを返す（`202`）
   - パスワードか TOTP が設定されていなければ `405`、合わなければ `403`
2. ブラウザで `startRegistration`。
3. 2 回目は結果（`type: "public-key"`）を送る。検証して認証器を足し、有効なデバイス名の一覧を返す。

ログインしていなくても使えます。そのときは `id` ヘッダーでメンバーを指定し、パスワードと TOTP で本人確認をします。

登録のオプションの中身は次のとおりです。

- `user`: `{ id: メンバー ID, name: 名前, displayName: 名前 }`
- `excludeCredentials`: その RP ID の全部の認証器

## 認証

### ログイン

1. `POST /i/login/option`（`{ id? }`）
   - ランダムな `sessionId`（base64url の 16 文字）を作り、それをキーにチャレンジを控える
   - `id` があれば、そのメンバーの有効なデバイスを `allowCredentials` にする。無ければ空（discoverable credential で選ばせる）
   - 返すもの: `{ type: "WebAuthn", options, sessionId }`
2. ブラウザで `startAuthentication`。`id` が無いときは条件付き UI（オートフィル）を使う。
3. `POST /i/login/verify`（`{ sessionId, result }`）
   - メンバー ID は `result.response.userHandle` から決める。無ければ `id` ヘッダーを使う
   - 検証が通ると、JWT（HS512、12 時間）を文字列で返す

### 認証の検証（共通）

`verifyChallengeForAuth` は次の順に進みます。

1. RP ID の認証器が無ければ `Wrong rpId`（`406`）。
2. `response.id` と同じ `credentialID` の認証器を探す。無ければ `No matching session id`（`400`）。
3. fido2-lib の `assertionResult` で検証する。期待値は次のとおり。
   - `publicKey`: 保存している PEM
   - `prevCounter`: 保存している `counter`
   - `userHandle`: メンバー ID（UTF-8）の base64url
   - `allowCredentials`: 有効なデバイス。`transports` から `hybrid` を除いてから渡す（fido2-lib 3.3.4 が `hybrid` を知らないため）
4. 通ったら `counter` を新しい値にして保存する。
   - カウンターが前より増えていないと失敗する。前も今も 0 のときだけは、カウンター非対応として通す
5. 失敗はすべて `Failed auth`（`403`）にする。

### WebAuthn を挟む操作

大事な操作は 2 段階で行います。

1. 操作の内容を送ると、`202` と assertion のオプションが返る。サーバーは、実行する操作（関数）をチャレンジと一緒にメモリに控える
2. assertion の結果（`type: "public-key"`）を同じパスに送ると、検証してから控えた操作を実行する

| 操作 | パス | 1 回目に送るもの | 実行の条件 |
| --- | --- | --- | --- |
| パスワードの変更 | `PUT /i/password` | `{ current, to }` | 今のパスワードが合うこと |
| パスワードのリセット | `POST /i/password` | `{ code, to }` | TOTP が合うこと |
| TOTP の登録 | `POST /i/totp/regist` | `{ pass, code }` | パスワードが合うこと（WebAuthn が無ければ挟まずに登録） |
| デバイスの確認 | `POST /i/webauthn/verify` | `{ deviceNames }` | 指定したデバイスで認証できること |
| デバイスの削除 | `POST /i/webauthn/device/:name/delete` | なし | なし。`{ type: "password", pass, code }` なら WebAuthn を挟まずに消す |
| 仮メンバーの承認・否認 | `POST /member/temp/admit`・`deny` | `{ ids }` | なし |
| シェルスクリプトの実行 | `POST /ex` | `{ n, o? }` | なし |

- 条件が合わないときも、オプションは返します。その場合は操作を控えないので、assertion が通っても何も起きません（パスワードの変更なら `422`）。
- assertion の `allowCredentials` は、そのメンバーの有効なデバイスです。デバイスの確認だけは、指定したデバイスにします。

### チャレンジの控え

`AuthChallenge` は、キーごとにチャレンジを 1 つだけメモリに持ちます。

| キー | 使う操作 |
| --- | --- |
| `sessionId` | ログイン |
| メンバー ID | パスワード、TOTP、デバイスの確認、仮メンバーの承認・否認、`/ex` |
| メンバー ID + デバイス名 | デバイスの削除 |

- 使うと消えます。同じキーで次の操作を始めると上書きされます。
- 作った時刻は持っていますが、期限は見ていません。
- 登録のチャレンジは `AuthChallenge` ではなく、メンバー（`Member.challengeWebAuthn`）に `{ デバイス名, チャレンジ }` として 1 つだけ持ちます。

## 気になる点

- オプションでは UV を `required` にしているが、検証は `factor: "either"` なので UV が無くても通る。
- チャレンジに期限が無く、メモリだけにある。
- `residentKey` を求めていないので、discoverable でない認証器も登録できる。そうした認証器は、ID を入れないログインでは使えない。
- `GET /member/member/:id` が `auth` の中身ごと返してしまう（[data.md](data.md#membersjson)）。

## v2 へ移すときのメモ

- `user.id` は v1 も v2（ebina-front の dev-server）も「ユーザー ID の UTF-8」なので、userHandle の形はそろっている。
- v1 の公開鍵は PEM（SPKI）。ES256 の認証器なら、PEM を DER に戻せば v2 が保存する SPKI と同じ形になる。
- ただし、v1 は ES256 以外のアルゴリズムも登録でき、discoverable でない認証器もある。v2 はどちらも受けない。
- RP ID は、v1 の既定（`variable`）ならクライアントのホスト名。クライアントが同じ（`nozomi-hiragi.github.io`）なら一致する。
