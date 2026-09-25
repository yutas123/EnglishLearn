import * as cheerio from "cheerio";
import { SCRAPER_API_KEY, ZENROWS_API_KEY } from "./config.js";

const GENIUS_API_URL = "https://api.genius.com";
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Renderなどデータセンターからの直接アクセスはCloudflareに403でブロックされるため、
 * genius.com（未公開の検索API・歌詞ページ）へのアクセスはプロキシ経由にする。
 * ZenRowsを優先し（無料枠が大きい）、無ければScraperAPI、どちらも無ければ直接アクセスする。
 */
function buildGeniusWebFetch(targetUrl) {
  if (ZENROWS_API_KEY) {
    return {
      url: `https://api.zenrows.com/v1/?apikey=${ZENROWS_API_KEY}&url=${encodeURIComponent(targetUrl)}`,
      headers: {},
    };
  }
  if (SCRAPER_API_KEY) {
    return {
      url: `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}`,
      headers: {},
    };
  }
  return {
    url: targetUrl,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  };
}

/**
 * 文字列を正規化（比較用）
 */
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Genius APIで曲を検索し、歌詞ページURLを取得
 * ネットワーク一時エラーは数回リトライする
 */
async function searchSong(artist, title, accessToken) {
  const query = encodeURIComponent(`${artist} ${title}`);
  const url = `${GENIUS_API_URL}/search?q=${query}&per_page=10`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        throw new Error(`Genius検索APIがエラーを返しました (status ${res.status})`);
      }

      const data = await res.json();

      if (!data.response || !data.response.hits) {
        throw new Error("Genius検索APIのレスポンス形式が不正です");
      }

      if (data.response.hits.length === 0) {
        return null; // 本当に見つからない（リトライ不要）
      }

      // 検索結果から曲名が完全一致するものを探す
      const targetTitle = normalize(title);
      for (const hit of data.response.hits) {
        const resultTitle = normalize(hit.result.title);
        if (resultTitle === targetTitle) {
          return hit.result.url;
        }
      }

      // 一致するものがなければnull（リトライ不要）
      return null;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const waitMs = attempt * 2000;
        console.log(`    ⚠️ Genius検索リトライ ${attempt}/${MAX_RETRIES}: ${error.message} (${waitMs / 1000}秒後に再試行)`);
        await sleep(waitMs);
        continue;
      }
      console.log(`    ⚠️ Genius検索に失敗しました: ${error.message}`);
      return null;
    }
  }

  return null;
}

/**
 * GeniusのページURLから歌詞をスクレイピング
 * ScraperAPI/Genius側の一時的な取得失敗は数回リトライする
 */
async function scrapeLyrics(url) {
  const { url: fetchUrl, headers } = buildGeniusWebFetch(url);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(fetchUrl, { headers });

      if (!res.ok) {
        throw new Error(`歌詞ページの取得に失敗しました (status ${res.status})`);
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      // Geniusの歌詞コンテナを取得
      const lyricsContainers = $('[data-lyrics-container="true"]');

      if (lyricsContainers.length === 0) {
        throw new Error("歌詞コンテナが見つかりません（一時的な取得失敗の可能性）");
      }

      let lyrics = "";

      lyricsContainers.each((_, container) => {
        // <br>タグを改行に変換
        $(container)
          .find("br")
          .replaceWith("\n");
        lyrics += $(container).text() + "\n";
      });

      lyrics = lyrics.trim();

      // Geniusは歌詞コンテナの先頭に「n Contributors...曲名 Lyrics」＋
      // （曲の説明文がある場合）「説明文… Read More」を挿入してから実際の歌詞を続ける。
      // 「Read More」があればその直後から、無ければ「Lyrics」の直後から本文として扱う
      const readMoreIndex = lyrics.indexOf("Read More");
      if (readMoreIndex !== -1) {
        lyrics = lyrics.slice(readMoreIndex + "Read More".length).trimStart();
      } else {
        const lyricsMarkerIndex = lyrics.indexOf("Lyrics");
        if (lyricsMarkerIndex !== -1) {
          lyrics = lyrics.slice(lyricsMarkerIndex + "Lyrics".length).trimStart();
        }
      }

      return lyrics;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const waitMs = attempt * 2000;
        console.log(`    ⚠️ 歌詞ページ取得リトライ ${attempt}/${MAX_RETRIES}: ${error.message} (${waitMs / 1000}秒後に再試行)`);
        await sleep(waitMs);
        continue;
      }
      console.log(`    ⚠️ 歌詞ページの取得に失敗しました: ${error.message}`);
      return null;
    }
  }

  return null;
}

/**
 * 歌詞を行ごとの配列に分割（空行・メタ情報を除去）。
 * セクション見出し [Verse 1: Paul McCartney & John Lennon] 等は歌詞本文からは除くが、
 * 誰が歌っているか表示するために、直後から次の見出しまでの各行に紐づくラベルとして保持する。
 * @returns {{ lines: string[], sectionByLine: (string|null)[] }}
 */
function parseLyricsToLines(lyrics) {
  // メタ情報として除外するパターン
  const metaPatterns = [
    /^contributors?$/i,
    /^translations?$/i,
    /^read more$/i,
    /^embed$/i,
    /^see .* live$/i,
    /^get tickets/i,
    /^\d+ contributors?$/i,
    /^\d+ translations?$/i,
    /^you might also like$/i,
    /^pyong$/i,
    /^share$/i,
    /^url$/i,
    /^copy$/i,
    /^report$/i,
  ];

  const lines = [];
  const sectionByLine = [];
  let currentSection = null;

  for (const rawLine of lyrics.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // セクション見出し [Verse 1: ...] は本文から除き、以降の行のラベルとして記憶する
    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1).trim() || null;
      continue;
    }

    if (metaPatterns.some((pattern) => pattern.test(line))) continue;

    lines.push(line);
    sectionByLine.push(currentSection);
  }

  return { lines, sectionByLine };
}

/**
 * Genius APIでアルバムURLを取得
 * 最初のヒット曲の詳細からアルバム情報を取得する
 * @param {string} artist - アーティスト名
 * @param {string} albumName - アルバム名
 * @param {string} accessToken - Genius APIトークン
 * @returns {Promise<string|null>} GeniusアルバムページURL、見つからない場合はnull
 */
export async function getAlbumUrl(artist, albumName, accessToken) {
  try {
    const query = encodeURIComponent(`${artist} ${albumName}`);
    const url = `${GENIUS_API_URL}/search?q=${query}&per_page=5`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    if (!data.response.hits || data.response.hits.length === 0) {
      return null;
    }

    // 検索結果からアーティストが一致するヒットを探す
    const targetArtist = normalize(artist);
    const hit = data.response.hits.find(
      (h) => normalize(h.result.primary_artist.name) === targetArtist
    );

    if (!hit) return null;

    // 曲の詳細からアルバム情報を取得
    const songId = hit.result.id;
    const songRes = await fetch(`${GENIUS_API_URL}/songs/${songId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const songData = await songRes.json();

    const album = songData.response.song.album;
    if (album && album.url) {
      return album.url;
    }

    return null;
  } catch (error) {
    console.log(`    ⚠️ Geniusアルバム検索エラー: ${error.message}`);
    return null;
  }
}

/**
 * アーティスト名と曲名から歌詞を取得
 * @returns {{ lines: string[], sectionByLine: (string|null)[] }|null} 見つからない場合はnull
 */
export async function getLyrics(artist, title, accessToken) {
  try {
    const songUrl = await searchSong(artist, title, accessToken);

    if (!songUrl) {
      console.log(`    ⚠️ Geniusで見つかりませんでした: ${title}`);
      return null;
    }

    const lyrics = await scrapeLyrics(songUrl);

    if (!lyrics) {
      console.log(`    ⚠️ 歌詞を取得できませんでした: ${title}`);
      return null;
    }

    return parseLyricsToLines(lyrics);
  } catch (error) {
    console.log(`    ⚠️ 歌詞取得エラー: ${error.message}`);
    return null;
  }
}

/**
 * Genius曲ページURLが既知の場合に、曲名検索を経由せず直接歌詞を取得する
 * （アルバム手動選択フローでは、アルバムのトラックリストから曲URLが既に判明しているため）
 * @returns {{ lines: string[], sectionByLine: (string|null)[] }|null} 見つからない場合はnull
 */
export async function getLyricsFromUrl(url) {
  try {
    const lyrics = await scrapeLyrics(url);

    if (!lyrics) {
      console.log(`    ⚠️ 歌詞を取得できませんでした: ${url}`);
      return null;
    }

    return parseLyricsToLines(lyrics);
  } catch (error) {
    console.log(`    ⚠️ 歌詞取得エラー: ${error.message}`);
    return null;
  }
}

/**
 * Genius公式サイトの検索サジェストAPI（未公開だがgenius.com自体が使用している）でアルバムを検索する。
 * アーティスト名や版違い（Super Deluxe Edition等）を含めて曲単位ではなくアルバム単位で候補を返す。
 * @returns {{ id: number, name: string, artistName: string, coverArtUrl: string|null, url: string }[]}
 */
export async function searchAlbums(query) {
  const targetUrl = `https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`;
  const { url: fetchUrl, headers } = buildGeniusWebFetch(targetUrl);

  const res = await fetch(fetchUrl, { headers });

  if (!res.ok) {
    throw new Error(`Geniusアルバム検索に失敗しました (status ${res.status})`);
  }

  const data = await res.json();
  const albumSection = (data?.response?.sections ?? []).find((s) => s.type === "album");
  const hits = albumSection?.hits ?? [];

  return hits.map((hit) => ({
    id: hit.result.id,
    name: hit.result.name,
    artistName: hit.result.artist?.name ?? "",
    coverArtUrl: hit.result.cover_art_url ?? null,
    url: hit.result.url,
  }));
}

/**
 * GeniusアルバムIDからアルバム基本情報を取得する
 * @returns {{ id: number, name: string, artistName: string, coverArtUrl: string|null, url: string }|null}
 */
export async function getAlbumDetail(albumId, accessToken) {
  const res = await fetch(`${GENIUS_API_URL}/albums/${albumId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Geniusアルバム情報の取得に失敗しました (status ${res.status})`);
  }

  const data = await res.json();
  const album = data?.response?.album;
  if (!album) return null;

  return {
    id: album.id,
    name: album.name,
    artistName: album.artist?.name ?? album.primary_artist_names ?? "",
    coverArtUrl: album.cover_art_url ?? null,
    url: album.url,
  };
}

/**
 * GeniusアルバムIDからトラックリスト（曲名・曲ページURL）を取得する。
 * 曲ページURLが判明しているため、後続の歌詞取得ではgetLyricsFromUrlを使い曲名検索を省略できる。
 * @returns {{ trackNo: number, title: string, url: string }[]}
 */
export async function getAlbumTracks(albumId, accessToken) {
  const res = await fetch(`${GENIUS_API_URL}/albums/${albumId}/tracks?per_page=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Geniusトラックリストの取得に失敗しました (status ${res.status})`);
  }

  const data = await res.json();
  const rawTracks = data?.response?.tracks ?? [];

  return rawTracks
    .filter((t) => t.song)
    .map((t, i) => ({
      trackNo: t.number ?? i + 1,
      title: t.song.title,
      url: t.song.url,
    }));
}
