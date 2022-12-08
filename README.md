# ebina-station

## dhparam.pemの作り方
` openssl dhparam -out /etc/ssl/certs/dhparam.pem 2048 `

## 使い方
クローンする

### 初回起動
- initEbinaStation.shでserviceを置いたりする
- startEbinaStation.shで起動できる
- 初回起動時にプロジェクト作成のための入力をする
- "start listeing"と出たら起動している

### SSL
ブラウザの仕様上SSLが必要です。一応コマンドでLet's Ecnryptを使って対応させられますが、不安定なので注意してください。自力で置く場合は、"project/nginx/site-enabled"に設定を書いて、"project/nginx/nginx.conf"に追記して読ませて対応させてください。

### ユーザーを作る
- "member temp regist"でユーザーを作成するトークンを生成する
- オプションを指定して希望の登録用URLを作れる
- "front {フロントのURL}" "server {これのあるURL}"
- ウェブから仮登録を完了させる
- "member temp list"で仮メンバー一覧を表示できる
- "member temp admit {仮免のID}"で本メンバーにする
- フロントのログインからログインできる

### プロジェクト
初回起動でプロジェクトの作成が成功すると、フォルダ直下にprojectフォルダができる。それをGitなりで管理してもいい。

## コマンド

### member temp　{sub command}
- list: 仮メンバー一覧表示
- regist {...options}
  - front {URL}: 出力URLのベースURL
  - server {URL}: サーバーのURL
  - id {ID}: 登録画面でデフォルトで入力されるID
  - name {Name}: 登録画面でデフォルトで入力される名前
- admit {ID}: IDの仮メンバーを本メンバーにする
- deny {ID}: IDの仮メンバーを消す

### certbot {sub command}
- certonly {...options}: 証明書発行
  - DOMAIN | --domains | -d {domain}: 投げるドメイン
  - EMAIL | --email | -m {email}: 投げるメールアドレス
- renew: 証明書更新

### route
- add {...options}: ルート追加
  - --hostname | -h {hostname}: 受けるホスト名
  - --port | -p {port}: ポート指定
  - --restart | -r: nginx再起動
  - --certbot | -c: certbotでcert
  - --email | -m {email}: certbotで使うメールアドレス
