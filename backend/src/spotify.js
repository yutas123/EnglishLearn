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
 * アーティスト名+アルバム名でSpotifyを検索し、ジャケット画像URLを取得。
 * 複数候補から「アーティスト名が完全一致し、アルバム名が最も近いもの」を選ぶことで、
 * 同名の別作品（例: "xx" と "XX (20th Anniversary...)"）を誤って掴まないようにする。
 * @returns {Promise<string|null>}
 */
export async function searchAlbumArt(artistName, albumName) {
  try {
    const accessToken = await getAccessToken();
    const q = encodeURIComponent(`album:${albumName} artist:${artistName}`);
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${q}&type=album&limit=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const items = data.albums?.items ?? [];
    if (items.length === 0) return null;

    const normalize = (s) => s.toLowerCase().trim();
    const targetArtist = normalize(artistName);
    const targetAlbum = normalize(albumName);

    const exact = items.find(
      (it) =>
        it.artists?.some((a) => normalize(a.name) === targetArtist) &&
        normalize(it.name) === targetAlbum
    );
    const artistMatch = items.find((it) =>
      it.artists?.some((a) => normalize(a.name) === targetArtist)
    );
    const chosen = exact ?? artistMatch ?? null;

    return chosen?.images?.[0]?.url ?? null;
  } catch {
    return null;
  }
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
