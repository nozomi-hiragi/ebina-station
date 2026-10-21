# AGENTS.md

AI エージェント向けの作業ルール。人間向けの説明は [README.md](README.md) を参照。

## プロジェクト概要

- EbinaStation のサーバー。v2 として作り直し中で、今は仕様（`docs/`）だけがある。v1 のコードは消した。参照するときは `v1.1.0` のタグを見る
- Station はクライアント（ebina-front）とアプリのあいだに立つ中継役。WAKE（KX / SM / ET）でログインとセッションを受け持ち、ET で受けたリクエストをパスの先頭のアプリ名で振り分けてアプリへ渡す。画面はアプリが Binette で返す
- 仕様は `docs/` にある。作業の前に該当する文書を読む

| 文書 | 内容 |
| --- | --- |
| `docs/spec.md` | v2 の全体の仕様 |
| `docs/station-json.md` | Station の設定ファイル |
| `docs/app-json.md` | 埋め込みアプリの設定ファイル |
| `docs/apps/<アプリ名>.md` | アプリごとの仕様 |
| `docs/v1/` | v1 の仕様の記録（API、WebAuthn、保存データ）。v2 では使わない |

- 関連する仕様:
  - ebina-front: [AGENTS.md](https://github.com/nozomi-hiragi/ebina-front/blob/v2.0.0/AGENTS.md)、[docs/ebina-front.md](https://github.com/nozomi-hiragi/ebina-front/blob/v2.0.0/docs/ebina-front.md)。今のクライアントとの契約は、ebina-front の `src/api/station.ts` と `dev-server/app.ts`
  - Binette: [docs/spec.md](https://github.com/nozomi-hiragi/binette/blob/main/docs/spec.md)
  - WAKE: [spec/wake-protocol.md](https://github.com/nozomi-hiragi/wake-protocol/blob/main/spec/wake-protocol.md)
- v1 の機能は `docs/v1/` を参考にしつつ、そのまま移植せず作り直す

## 役割分担

モデルを 3 段階に分け、作業内容によって担当を決める。

| 区分 | モデル | 担当 |
| --- | --- | --- |
| 高 | Opus, Sol6.1 Ultra, Astra | 方針決定、設計、指示出し、進捗の監視、レビュー、最終確認 |
| 中 | Sonnet, Sol | 複雑な実装（認証、WAKE のストア、中継、子プロセスの管理、複数ファイルにまたがる設計判断を含むもの） |
| 低 | Haiku, Luna | 仕様が明確な実装、ビネットの画面作成、修正、ドキュメント作成、定型作業 |

### 高モデルの進め方

- 実装は自分でせず、中・低モデルのサブエージェントに任せる。小さな修正も原則として差し戻す
- 中モデルに任せるかどうかは、判断を要する箇所の多さで決める。迷ったら低モデルで始め、詰まったら中モデルに切り替える
- 互いに干渉しない作業は並列で任せてよい。同じファイルを触る作業は順番に任せる
- サブエージェントの報告をそのまま信じない。差分を読み、検査（下記「開発コマンド」）を自分でも実行して確かめる
- ユーザーへの報告は、検証したことと未検証のこと（ブラウザでの動作など）を分けて書く

### 指示の書き方（高 → 中・低）

指示には次を必ず含める。受け手は会話の文脈を持っていない前提で書く。

1. 作業ディレクトリ（絶対パス）
2. 目的と、やらないこと（範囲外のファイル、未実装のままにする処理）
3. 参照すべきファイル・仕様（パスで指定）
4. 具体的な手順と、従うべき規約（このファイルの該当節を示してよい）
5. 完了条件（例: 検査が通る）
6. 報告してほしい内容（変更したファイル、検査の結果、推測で決めた点）

### 報告の書き方（中・低 → 高）

- 変更・作成・削除したファイルの一覧
- 検査の結果（末尾数行）
- 仕様に無く、自分で決めた点や推測した点
- 指示どおりにできなかった点とその理由

### レビュー観点

- 指示と仕様に合っているか。範囲外の変更が混ざっていないか
- 仕様（`docs/`）と実装がずれていないか。ずれたら仕様も直す
- クライアントから来た値（ET の URL、ヘッダー、本文）を信じすぎていないか。`Ebina-` で始まるヘッダーを捨ててから付けているか
- アプリの子プロセスに、仕様より広い権限を与えていないか
- 秘密（`Ebina-App-Token`、WAKE の `secret`、パスキーの情報）をログや応答に出していないか
- 余計な依存パッケージが増えていないか

## 開発コマンド

まだコードが無い。実装を始めるときに `deno.json` の `tasks` を作り、ここに書く。予定は次のとおり。

```sh
deno task dev     # 開発用に起動（--watch）
deno task check   # deno fmt --check、deno lint、deno check
deno task test    # deno test
```

- 作業の完了前に必ず `deno task check` と `deno task test` を通す（作ったら）

## 技術スタックと構成

- Deno 2 + TypeScript
- Hono、`@wake-protocol/server`、`@binette/core`、`@binette/coulisses`
- 保存は SQLite（`project/data/station/station.db`）。形はまだ決めていない
- 依存は `deno.json` の `imports` に `npm:` か `jsr:` で書き、版を固定する。`deno.land/x` や URL の直書きの import は使わない

構成はまだ決めていない。決めたらここに書く。

## 仕様と契約のルール

- 仕様（`docs/`）を変える実装は、同じ変更で文書も直す
- クライアントとの契約（登録の API、WAKE のパス、ET の URL と応答）を変えるときは、ebina-front の `src/api/station.ts` と `dev-server/app.ts` も合わせて直す必要がある。変える前にユーザーに確かめる
- ET で運ぶ URL は `wake://station/…` で表す。未知の URL には 404 `{"error":{"code":"not_found"}}` を返す
- アプリ名の規則と予約名は `docs/spec.md` の「アプリ名」に従う
- アプリごとの仕様は `docs/apps/<アプリ名>.md` に書き、`docs/spec.md` の「アプリ」の表に足す

## コーディング規約

- `deno fmt` と `deno lint` の既定に従う
- 型は `any` を使わない。外から来た値は検査してから使う（`@binette/core` の検査や、必要なら valibot）
- エラーの応答は日本語のメッセージにする（形は仕様の各節に従う）
- コメントは必要な箇所だけ、日本語で書く
- ファイルは小さく保つ。役割ごとにディレクトリを分ける

## Git

- コミット・push はユーザーに頼まれたときだけ行う
- コミットメッセージは日本語。1 行目に変更の要約を書く
- 作業前に `git status` を確認し、自分が触っていない変更を勝手にコミット・破棄しない
- `project/` は Station のデータなのでコミットしない
- ファイルを消すときは変数を使わず絶対パスで指定する
