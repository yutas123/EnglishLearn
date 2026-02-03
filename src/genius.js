import * as cheerio from "cheerio";

const GENIUS_API_URL = "https://api.genius.com";

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
 */
async function searchSong(artist, title, accessToken) {
  const query = encodeURIComponent(`${artist} ${title}`);
  const url = `${GENIUS_API_URL}/search?q=${query}&per_page=10`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await res.json();

  if (!data.response.hits || data.response.hits.length === 0) {
    return null;
  }

  // 検索結果から曲名が完全一致するものを探す
  const targetTitle = normalize(title);
  for (const hit of data.response.hits) {
    const resultTitle = normalize(hit.result.title);
    if (resultTitle === targetTitle) {
      return hit.result.url;
    }
  }

  // 一致するものがなければnull
  return null;
}

/**
 * GeniusのページURLから歌詞をスクレイピング
 */
async function scrapeLyrics(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  // Geniusの歌詞コンテナを取得
  const lyricsContainers = $('[data-lyrics-container="true"]');

  if (lyricsContainers.length === 0) {
    return null;
  }

  let lyrics = "";

  lyricsContainers.each((_, container) => {
    // <br>タグを改行に変換
    $(container)
      .find("br")
      .replaceWith("\n");
    lyrics += $(container).text() + "\n";
  });

  return lyrics.trim();
}

/**
 * 歌詞を行ごとの配列に分割（空行・セクション見出しを除去）
 */
function parseLyricsToLines(lyrics) {
  return lyrics
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      // 空行を除去
      if (!line) return false;
      // セクション見出し [Verse 1] などを除去
      if (line.startsWith("[") && line.endsWith("]")) return false;
      return true;
    });
}

/**
 * アーティスト名と曲名から歌詞を取得
 * @returns {string[]|null} 歌詞の行配列、見つからない場合はnull
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
