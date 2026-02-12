import * as cheerio from "cheerio";

/**
 * Geniusアルバムページをスクレイピングしてアルバム情報を取得
 * @param {string} albumUrl - GeniusアルバムページURL (例: https://genius.com/albums/Artist/Album-name)
 * @returns {Promise<{albumName: string, artistName: string, coverArtUrl: string, geniusUrl: string, tracks: Array<{trackNo: number, title: string, songUrl: string}>}>}
 */
export async function scrapeAlbumPage(albumUrl) {
  const res = await fetch(albumUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`アルバムページの取得に失敗しました (${res.status}): ${albumUrl}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // アルバム名
  const albumName = $(".header_with_cover_art-primary_info-title").text().trim();
  if (!albumName) {
    throw new Error("アルバム名を取得できませんでした");
  }

  // アーティスト名
  const artistName = $(".header_with_cover_art-primary_info-primary_artist").text().trim();

  // ジャケット画像URL (og:imageから高解像度版を取得)
  const coverArtUrl = $('meta[property="og:image"]').attr("content") || null;

  // トラックリスト
  const tracks = [];
  $(".chart_row").each((_, el) => {
    const numberText = $(el).find(".chart_row-number_container-number").text().trim();
    const trackNo = parseInt(numberText, 10);
    if (isNaN(trackNo)) return; // ボーナストラック等（番号なし）はスキップ

    const title = $(el)
      .find(".chart_row-content-title")
      .first()
      .contents()
      .filter(function () {
        return this.type === "text";
      })
      .text()
      .trim();

    const songUrl = $(el).find("a.u-display_block").attr("href") ||
      $(el).find("a").first().attr("href") || "";

    if (title && songUrl) {
      tracks.push({ trackNo, title, songUrl });
    }
  });

  if (tracks.length === 0) {
    throw new Error("トラックリストを取得できませんでした");
  }

  return {
    albumName,
    artistName,
    coverArtUrl,
    geniusUrl: albumUrl,
    tracks,
  };
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
 * 歌詞を行ごとの配列に分割（空行・セクション見出し・メタ情報を除去）
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

  return lyrics
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      // 空行を除去
      if (!line) return false;
      // セクション見出し [Verse 1] などを除去
      if (line.startsWith("[") && line.endsWith("]")) return false;
      // メタ情報パターンに一致する行を除去
      for (const pattern of metaPatterns) {
        if (pattern.test(line)) return false;
      }
      return true;
    });
}

/**
 * 曲ページURLから直接歌詞を取得
 * @param {string} songUrl - Genius曲ページURL
 * @returns {Promise<string[]|null>} 歌詞の行配列、取得できない場合はnull
 */
export async function getLyricsFromUrl(songUrl) {
  try {
    const lyrics = await scrapeLyrics(songUrl);

    if (!lyrics) {
      console.log(`    ⚠️ 歌詞を取得できませんでした: ${songUrl}`);
      return null;
    }

    return parseLyricsToLines(lyrics);
  } catch (error) {
    console.log(`    ⚠️ 歌詞取得エラー: ${error.message}`);
    return null;
  }
}
