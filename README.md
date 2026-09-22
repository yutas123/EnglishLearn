# EnglishLearn

洋楽の歌詞対訳を自動生成する学習アプリ。Spotifyで再生中のアルバムをボタン1つで検知し、
Render上の常駐サーバーが非同期にMusicBrainz→Genius→OpenAIのパイプラインを実行してPostgresに保存、
Vercel上のNext.js（ISR）で軽量に閲覧する構成。

## 構成

```
backend/   # Render にデプロイするジョブワーカー + API（Express / Prisma）
frontend/  # Vercel にデプロイする閲覧用サイト（Next.js App Router / Prisma）
```

両者は同じPostgresデータベース（`DATABASE_URL`）を共有する。書き込みは主に `backend` が担い、
`frontend` はDBから直接読み取って表示する（ハイライト作成のみ `frontend` 側からも書き込む）。

## セットアップ（初回のみ・手動での外部サービス準備が必要）

以下はアカウント操作を伴うためAIエージェントでは代行できません。順番に実施してください。

### 1. Render Postgres の作成

1. Render ダッシュボードで新規 PostgreSQL インスタンスを作成
2. 接続文字列（Internal/External Database URL）を控える → これが `DATABASE_URL`

### 2. Prisma マイグレーションの適用

```bash
cd backend
cp .env.example .env   # DATABASE_URL 等を記入
npx prisma migrate dev --name init
```

### 3. Render Web Service の作成（backend）

1. 本リポジトリを接続し、`render.yaml` を読み込ませる（Root Directoryは自動的に`backend`になる）
2. 環境変数を設定：`DATABASE_URL`, `GENIUS_ACCESS_TOKEN`, `OPENAI_API_KEY`, `SCRAPER_API_KEY`,
   `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`,
   `VERCEL_REVALIDATE_URL`, `VERCEL_REVALIDATE_SECRET`
   （`SPOTIFY_REFRESH_TOKEN` は手順5で取得）

### 4. Spotify Developer App の登録

1. https://developer.spotify.com/dashboard でアプリを新規作成
2. Redirect URI に `http://127.0.0.1:8888/callback` を追加
3. Client ID / Client Secret を控える

### 5. Spotify refresh_token の取得（ローカルで一度だけ）

```bash
cd backend
node scripts/spotify-auth.js
```

表示されたURLをブラウザで開いて許可すると、ターミナルに `refresh_token` が表示される。
それを Render の環境変数 `SPOTIFY_REFRESH_TOKEN` に設定する。

### 6. Vercel プロジェクトの作成（frontend）

1. 本リポジトリをインポートし、Root Directory を `frontend` に設定
2. 環境変数を設定：`DATABASE_URL`（Renderと同じPostgres）, `REVALIDATE_SECRET`（任意の秘密文字列。
   Render側の `VERCEL_REVALIDATE_SECRET` と同じ値にする）
3. デプロイ後のURL（例: `https://xxx.vercel.app`）を控える

### 7. 双方の連携用URLを設定

- Render の `VERCEL_REVALIDATE_URL` に `https://<vercelのURL>/api/revalidate` を設定
- ローカル/Vercel の `NEXT_PUBLIC_BACKEND_URL` に Render のURL（例: `https://xxx.onrender.com`）を設定

## ローカル開発

```bash
# backend
cd backend
npm install
npm start          # http://localhost:3000

# frontend（別ターミナル）
cd frontend
cp .env.local.example .env.local
npm install
npm run dev         # http://localhost:3000 と衝突する場合は PORT を調整
```

## 既知の制約

- 同一アーティスト+アルバム名のアルバムは重複登録されず、既存のものにリンクされる
- ジョブ失敗時の自動リトライはなし。DBの`Job`テーブルの該当行を`status: "pending"`に戻すことで再実行される
  （既にAlbumレコードが作成済みの場合は重複防止ロジックにより即完了扱いになるため、
  曲登録の途中で失敗した場合は該当Albumを削除してから再実行する必要がある）
