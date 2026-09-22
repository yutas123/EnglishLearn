import http from "node:http";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

/**
 * Spotify OAuth Authorization Code Flow を一度だけローカルで実行し、
 * refresh_token を取得するためのヘルパースクリプト。
 *
 * 使い方:
 *   1. Spotify Developer Dashboard でアプリを作成し、
 *      Redirect URI に http://127.0.0.1:8888/callback を登録する
 *   2. backend/.env に SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET を設定する
 *   3. `node scripts/spotify-auth.js` を実行し、表示されたURLをブラウザで開いて許可する
 *   4. ターミナルに表示された refresh_token を Render の環境変数 SPOTIFY_REFRESH_TOKEN に設定する
 */

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = "user-read-currently-playing user-read-playback-state";
const PORT = 8888;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "❌ backend/.env に SPOTIFY_CLIENT_ID と SPOTIFY_CLIENT_SECRET を設定してから実行してください"
  );
  process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");

const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
authorizeUrl.searchParams.set("client_id", CLIENT_ID);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authorizeUrl.searchParams.set("scope", SCOPES);
authorizeUrl.searchParams.set("state", state);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end();
    return;
  }

  const returnedState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`認可が拒否されました: ${error}`);
    console.error(`❌ 認可が拒否されました: ${error}`);
    server.close();
    process.exit(1);
  }

  if (returnedState !== state || !code) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("state不一致またはcodeがありません");
    server.close();
    process.exit(1);
  }

  try {
    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
      "base64"
    );

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await tokenRes.json();

    if (!tokenRes.ok) {
      throw new Error(JSON.stringify(data));
    }

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("認可が完了しました。ターミナルを確認してください。閉じて構いません。");

    console.log("\n✅ 認可が完了しました。以下をRenderの環境変数 SPOTIFY_REFRESH_TOKEN に設定してください:\n");
    console.log(data.refresh_token);
    console.log("");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("トークン交換に失敗しました。ターミナルを確認してください。");
    console.error(`❌ トークン交換に失敗しました: ${err.message}`);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log("以下のURLをブラウザで開いてSpotifyアカウントで許可してください:\n");
  console.log(authorizeUrl.toString());
  console.log(`\n(${REDIRECT_URI} でのコールバック待機中...)`);
});
