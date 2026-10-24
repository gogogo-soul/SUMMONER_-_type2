# SUMMONER オンライン対戦 — 完全無料枠での公開手順

## 採用構成

- ブラウザ画面：既存の GitHub Pages（HTML / CSS / JavaScript、静的ファイル）
- 対戦サーバー：Cloudflare Workers Free + SQLite-backed Durable Objects
- 対戦通信：WebSocket（Durable Objects の Hibernation API）
- 山札・手札：サーバーでシャッフル／ドロー／保存し、本人だけに手札内容を配信
- ルーム：招待コードで2人参加、片方が作成者・片方が参加者
- PHP・有料VPS・独自ドメイン：不要

Cloudflare Freeプランは無料枠と利用上限があります。アクセスが上限を超えた場合は処理が失敗することがあり、無制限に利用できるわけではありません（2026-10現在）。
公式 https://developers.cloudflare.com/durable-objects/platform/pricing/

**今回のZIPだけをGitHubへアップロードしてもオンライン対戦は始まりません。対戦サーバーのデプロイが必須です。** Cloudflareへの実際の公開作業と端末間の通信試験は利用者のアカウント環境で実施してください。

## 1. Cloudflare Freeアカウントを作る

https://dash.cloudflare.com/sign-up からCloudflareのアカウントを作成します。Freeプランで構いません。
https://developers.cloudflare.com/durable-objects/ のDurable Objects Free対応を確認できます。

## 2. PCでNode.jsを用意

Node.js LTSをインストールします： https://nodejs.org/

Windows PowerShellで `npm` がスクリプト実行ポリシーに遮断される場合は、`npm.cmd` と `npx.cmd` を使うか、コマンドプロンプトで実行します。

## 3. Worker設定を編集

ZIPを解凍し `online-server/wrangler.toml` を開きます。

```toml
[vars]
ALLOWED_ORIGINS = "https://YOURNAME.github.io"
ALLOW_LOCAL = "true"
```

`YOURNAME` を自分のGitHubユーザー名に変更してください。**末尾にスラッシュやリポジトリ名を付けない**でください。
例：ページURLが `https://example.github.io/SUMMONER/` なら、Originは `https://example.github.io` です。

GitHub Pages以外のドメインを使う場合も、表示される実際のサイトのOrigin（スキーム＋ホスト＋必要ならポート）に変更してください。複数Originはカンマ区切りです。

## 4. Workerを無料で公開

コマンドプロンプトかPowerShellで、解凍した `online-server` フォルダへ移動します。

```powershell
cd C:\path\to\SUMMONER\online-server
npm.cmd install
npx.cmd wrangler login
npm.cmd run deploy
```

ブラウザでCloudflareにログインして、Wranglerの認証を許可します。最後に以下のようなURLが表示されます。

```text
https://summoner-online-duel.<your-subdomain>.workers.dev
```

このURLは例です。自分のアカウントで**実際に発行されたURL**を使ってください。`<your-subdomain>`をそのまま使っても接続できません。

## 5. ゲームサイトを更新

- GitHub PagesにはZIP直下の `index.html`、`online.html`、`online-client.js`、`online-config.js`、`cards.js` 等を含む静的ファイル一式をアップロードします。
- `online-server` はCloudflare用のソースコードです。GitHub Pagesに置いても実行されません（公開リポジトリに入れる必要もありません）。
- `online-config.js` の右辺に、発行されたURLを入力すると利用者が自分でURLを入力する必要がなくなります。

```javascript
window.SUMMONER_ONLINE_SERVER = 'https://実際のアカウントのURL.workers.dev';
```

ゲーム内の「オンライン対戦」で直接Worker URLを入力して保存することも可能です。招待URLにはWorker URLとルームコードが含まれますが、**認証用トークンは含まれません**。

## 6. 2人で対戦する

1. ホスト側で「オンライン対戦」→「ルーム作成」。
2. 画面に表示された招待URLを相手へ送る。
3. 相手が自分のブラウザでURLを開き「参加する」を押す。
4. 各自が初期デッキ7種類または自分の保存デッキから1つを選び、「デッキを登録」→「準備完了」。
5. 双方準備完了で対戦開始。相手の手札は裏向きの枚数表示のみ、自分の手札は内容を表示。
6. 流脈を置く→タップしてマナを作る→カードをプレイ。カードを選択して操作ボタンを使い、スタックはPASSして解決する。
7. 切断時は同じ端末・ブラウザで再アクセスすれば再接続を試みます。

## セキュリティ

- 対戦状態・山札の順番・手札は各ルームのDurable Objectに保存し、クライアントから自由に書き換えられません。
- 相手に送るメッセージには、手札内容・山札内容・自分のデッキ全リストを含めません。
- 接続に必要なランダムな座席トークンはブラウザに保存されます。共有やスクリーンショット公開はしないでください。
- 他のWebサイトからの接続は `ALLOWED_ORIGINS` で拒否します。ローカルテストの `ALLOW_LOCAL` は、公開時には必要に応じて `false` にしてください。
- サーバーへの不正入力を検証しますが、負荷攻撃・競技利用まで想定した防御を保証するものではありません。

## 検証

`online-server` フォルダで

```powershell
npm.cmd test
```

サーバーの純粋な対戦ロジックを検証できます。**Cloudflareで実際に公開できたかどうかを確認するものではありません**。

## オンライン版の重要な制限

`ONLINE_LIMITATIONS.md` を必ず確認してください。オンライン版は独立したサーバー実装で、既存の1端末ローカル対戦と全カード処理が完全一致したわけではありません。競技大会や一般公開の前には追加の相互試験が必要です。
