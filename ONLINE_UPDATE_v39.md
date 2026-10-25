# SUMMONER Beta2 v39 — 更新手順

## 1. GitHub Pagesの更新

`SUMMONER_Beta2_v39_GitHub_UpdateOnly.zip`を解凍し、中の7ファイルをGitHubリポジトリの同名ファイルに上書きアップロードします（ZIP自体はアップロードしません）。

- `index.html`
- `online.html`
- `online-client.js`
- `online-field-overrides.css`
- `starter-decks.js`
- `sw.js`
- `updates.html`

**`online-config.js`は変更しません。** 既存のCloudflare URL設定を維持してください。GitHub Pagesを開き直し、必要ならブラウザのサイトデータ／PWAキャッシュを更新してください。

## 2. Cloudflare Workersの更新

`SUMMONER_v39_Cloudflare_Server_Restore.zip`をPCに解凍し、`UPDATE_CLOUDFLARE.cmd`をダブルクリックします。前のPCフォルダは不要です。

- 元の `https://...workers.dev` URLを入力。
- SUMMONERのGitHub Pages URLを入力。
- 表示されたWorker名が元のCloudflare Workerと一致することを確認し、`YES` を入力。
- 元と同じCloudflareアカウントでログイン。
- サーバーテスト→デプロイ→実際の`/health`確認が自動で実行されます。

**成功条件:** 元のWorkers URLの`/health`が`"version":"alpha2-v39"`を返すこと。

## 3. 2端末確認

両端末のページを再読み込みし、新しいルームを作成してください。盤面のカード中央の操作、モンスター全タップ時の直接攻撃、勝敗時のWIN/LOSE→再戦画面、エラーの固定表示、スマホでのカードサイズなどを確認してください。

## 注意

新しいWorker名で公開すると元のGitHub接続先と食い違う場合があります。必ず元のWorker名とCloudflareアカウントを確認してください。Cloudflareへ自動公開済みという意味ではありません。ZIPを使ってユーザー側で更新する必要があります。

ローカル版の特殊効果との完全一致、公開環境の2端末リアルタイム対戦は引き続き検証中です。
