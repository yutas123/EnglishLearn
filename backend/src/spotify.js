import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN,
} from "./config.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const CURRENTLY_PLAYING_URL =
  "https://api.spotify.com/v1/me/player/currently-playing";

let cachedAccessToken = null;
let cachedExpiresAt = 0; // epoch ms

/**
 * refresh_token を使ってaccess tokenを取得（有効期限内はキャッシュを再利用）
 */
async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedExpiresAt) {
    return cachedAccessToken;
  }

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
    throw new Error(
      "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN が設定されていません"
    );
  }

  const basicAuth = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotifyトークン更新に失敗しました: ${res.status} ${text}`);
  }

  const data = await res.json();

  cachedAccessToken = data.access_token;
  // 期限の30秒前で切れたものとして扱う（余裕を持たせる）
  cachedExpiresAt = Date.now() + (data.expires_in - 30) * 1000;

  return cachedAccessToken;
}

/**
 * 現在Spotifyで再生中のアルバム情報を取得
 * @returns {Promise<{artistName: string, albumName: string} | null>} 何も再生していない場合はnull
 */
export async function getCurrentlyPlayingAlbum() {
  const accessToken = await getAccessToken();

  const res = await fetch(CURRENTLY_PLAYING_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 再生中の曲がない場合、Spotifyは204を返す
  if (res.status === 204) {
    return null;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify再生状況の取得に失敗しました: ${res.status} ${text}`);
  }

  const data = await res.json();

  const item = data.item;
  if (!item || !item.album) {
    return null;
  }

  const artistName = item.album.artists?.[0]?.name ?? item.artists?.[0]?.name;
  const albumName = item.album.name;

  if (!artistName || !albumName) {
    return null;
  }

  return { artistName, albumName };
}
