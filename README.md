# EbinaStation

EbinaStation は、クライアント（[ebina-front](https://github.com/nozomi-hiragi/ebina-front)）とアプリのあいだに立つサーバーです。パスキーでのログインとセッション（[WAKE](https://github.com/nozomi-hiragi/wake-protocol)）を受け持ち、クライアントからのリクエストをアプリへ中継します。画面はアプリが [Binette](https://github.com/nozomi-hiragi/binette) で返します。

> [!WARNING]
> v2 として作り直し中です。まだ動きません。v1 は [`v1.1.0` のタグ](https://github.com/nozomi-hiragi/ebina-station/tree/v1.1.0) を参照してください。

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
