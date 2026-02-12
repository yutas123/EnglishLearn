import { scrapeAlbumPage, getLyricsFromUrl } from "./src/genius.js";
import { createAlbum, createTrack, addLyricsToPage, addTrackListToAlbum, addSongAnalysisToPage } from "./src/notion.js";
import { translateLyrics, generateSongAnalysis } from "./src/translator.js";
import { OPENAI_API_KEY } from "./src/config.js";

/**
 * ★ 入力はここだけ ★
 */
const GENIUS_ALBUM_URL = "https://genius.com/albums/The-beatles/With-the-beatles";

async function main() {
  try {
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY が設定されていません");
    }

    // ① Geniusアルバムページからアルバム情報+トラックリストを取得
    console.log(`🔍 Geniusアルバムページを取得中: ${GENIUS_ALBUM_URL}`);
    const album = await scrapeAlbumPage(GENIUS_ALBUM_URL);
    console.log(`🎯 アルバム: ${album.artistName} - ${album.albumName}`);
    console.log(`🎧 ${album.tracks.length} 曲取得`);

    // ② Notionにアルバム作成（ジャケット画像+Geniusリンク付き）
    console.log(`📀 アルバム作成中: ${album.albumName}`);
    const albumPageId = await createAlbum({
      albumName: album.albumName,
      coverArtUrl: album.coverArtUrl,
      geniusUrl: album.geniusUrl,
    });
    console.log(`✅ アルバム作成完了 (ID: ${albumPageId})`);

    // ③ 各トラックをNotionに登録 + 歌詞と対訳
    const createdTracks = [];

    for (const track of album.tracks) {
      console.log(`  → 登録中: ${track.trackNo}. ${track.title}`);

      const trackPageId = await createTrack({
        title: track.title,
        trackNo: track.trackNo,
        albumPageId: albumPageId,
      });

      createdTracks.push({
        trackNo: track.trackNo,
        title: track.title,
        pageId: trackPageId,
      });

      // 歌詞取得（曲ページURLから直接スクレイピング）
      console.log(`    📝 歌詞を取得中...`);
      const lyrics = await getLyricsFromUrl(track.songUrl);

      if (lyrics && lyrics.length > 0) {
        console.log(`    🌐 対訳を生成中... (${lyrics.length}行)`);
        const translations = await translateLyrics(lyrics, OPENAI_API_KEY);

        console.log(`    📄 Notionに歌詞を追加中...`);
        await addLyricsToPage(trackPageId, translations);

        // 楽曲解説を生成・追加
        console.log(`    📖 楽曲解説を生成中...`);
        const analysis = await generateSongAnalysis(
          lyrics,
          track.title,
          album.artistName,
          OPENAI_API_KEY
        );
        if (analysis) {
          await addSongAnalysisToPage(trackPageId, analysis);
        }

        console.log(`    ✅ 完了`);
      }

      // API制限対策のため少し待機
      await sleep(1000);
    }

    // ④ アルバムページにトラックリストを追加
    console.log(`📋 アルバムページにトラックリストを追加中...`);
    await addTrackListToAlbum(albumPageId, createdTracks);

    console.log("🎉 完了！アルバムと全曲（歌詞付き）がNotionに登録されました");
  } catch (error) {
    console.error("❌ エラー発生:", error.message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
