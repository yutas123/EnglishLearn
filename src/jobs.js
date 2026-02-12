import { searchRelease, getTrackList } from "./musicbrainz.js";
import {
  createAlbum,
  createTrack,
  addLyricsToPage,
  addTrackListToAlbum,
  addSongAnalysisToPage,
  updateAlbumGeniusLink,
} from "./notion.js";
import { getLyrics, getAlbumUrl } from "./genius.js";
import { translateLyrics, generateSongAnalysis } from "./translator.js";
import { GENIUS_ACCESS_TOKEN, OPENAI_API_KEY } from "./config.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * console.log をキャプチャして log コールバックにも流すラッパー
 * 既存モジュール内の console.log を変更せずにキャプチャする
 */
function withLogCapture(log) {
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => {
    originalLog(...args);
    log(args.map(String).join(" "));
  };
  console.error = (...args) => {
    originalError(...args);
    log(args.map(String).join(" "));
  };

  return () => {
    console.log = originalLog;
    console.error = originalError;
  };
}

/**
 * アルバム処理（index.js の main() 相当）
 * @param {string} artistName - アーティスト名
 * @param {string} albumName - アルバム名
 * @param {(msg: string) => void} log - 進捗コールバック
 */
export async function processAlbum(artistName, albumName, log = console.log) {
  const restore = withLogCapture(log);

  try {
    if (!GENIUS_ACCESS_TOKEN) {
      throw new Error("GENIUS_ACCESS_TOKEN が設定されていません");
    }
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY が設定されていません");
    }

    log(`🔍 MusicBrainz 検索中: ${artistName} - ${albumName}`);

    // ① Release検索
    const { releaseId, albumTitle } = await searchRelease(
      artistName,
      albumName
    );

    log(`🎯 Release確定: ${albumTitle}`);
    log(`🆔 Release ID: ${releaseId}`);

    // ② トラック取得
    const tracks = await getTrackList(releaseId);
    log(`🎧 ${tracks.length} 曲取得`);

    // ③ Notionにアルバム作成
    log(`📀 アルバム作成中: ${albumTitle}`);
    const albumPageId = await createAlbum({ albumName: albumTitle, releaseId });
    log(`✅ アルバム作成完了 (ID: ${albumPageId})`);

    // ③-2 GeniusアルバムURLを取得してNotionに保存
    log(`🔗 Geniusアルバムリンクを検索中...`);
    const geniusAlbumUrl = await getAlbumUrl(
      artistName,
      albumName,
      GENIUS_ACCESS_TOKEN
    );
    if (geniusAlbumUrl) {
      await updateAlbumGeniusLink(albumPageId, geniusAlbumUrl);
      log(`✅ Geniusリンク設定完了: ${geniusAlbumUrl}`);
    } else {
      log(`⚠️ Geniusアルバムリンクが見つかりませんでした`);
    }

    // ④ 各トラックをNotionに登録 + 歌詞と対訳
    const createdTracks = [];

    for (const track of tracks) {
      log(`  → 登録中: ${track.trackNo}. ${track.title}`);

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

      log(`    📝 歌詞を取得中...`);
      const lyrics = await getLyrics(
        artistName,
        track.title,
        GENIUS_ACCESS_TOKEN
      );

      if (lyrics && lyrics.length > 0) {
        log(`    🌐 対訳を生成中... (${lyrics.length}行)`);
        const translations = await translateLyrics(lyrics, OPENAI_API_KEY);

        log(`    📄 Notionに歌詞を追加中...`);
        await addLyricsToPage(trackPageId, translations);

        log(`    📖 楽曲解説を生成中...`);
        const analysis = await generateSongAnalysis(
          lyrics,
          track.title,
          artistName,
          OPENAI_API_KEY
        );
        if (analysis) {
          await addSongAnalysisToPage(trackPageId, analysis);
        }

        log(`    ✅ 完了`);
      }

      await sleep(1000);
    }

    // ⑤ アルバムページにトラックリストを追加
    log(`📋 アルバムページにトラックリストを追加中...`);
    await addTrackListToAlbum(albumPageId, createdTracks);

    log("🎉 完了！アルバムと全曲（歌詞付き）がNotionに登録されました");
  } catch (error) {
    log(`❌ エラー発生: ${error.message}`);
    throw error;
  } finally {
    restore();
  }
}

/**
 * トラック単位の処理（track.js の main() 相当）
 * @param {string} artistName - アーティスト名
 * @param {Array<{title: string, notionPageId: string}>} tracks - トラック配列
 * @param {(msg: string) => void} log - 進捗コールバック
 */
export async function processTracks(artistName, tracks, log = console.log) {
  const restore = withLogCapture(log);

  try {
    if (!GENIUS_ACCESS_TOKEN) {
      throw new Error("GENIUS_ACCESS_TOKEN が設定されていません");
    }
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY が設定されていません");
    }

    log(`🎵 楽曲単位の翻訳を開始 (${tracks.length} 曲)`);

    for (const track of tracks) {
      log(`\n  → 処理中: ${track.title}`);

      log(`    📝 歌詞を取得中...`);
      const lyrics = await getLyrics(
        artistName,
        track.title,
        GENIUS_ACCESS_TOKEN
      );

      if (!lyrics || lyrics.length === 0) {
        log(`    ⚠️ 歌詞が取得できませんでした: ${track.title}`);
        continue;
      }

      log(`    🌐 対訳を生成中... (${lyrics.length}行)`);
      const translations = await translateLyrics(lyrics, OPENAI_API_KEY);

      log(`    📄 Notionに歌詞を追加中...`);
      await addLyricsToPage(track.notionPageId, translations);

      log(`    📖 楽曲解説を生成中...`);
      const analysis = await generateSongAnalysis(
        lyrics,
        track.title,
        artistName,
        OPENAI_API_KEY
      );
      if (analysis) {
        await addSongAnalysisToPage(track.notionPageId, analysis);
      }

      log(`    ✅ 完了: ${track.title}`);

      if (tracks.length > 1) {
        await sleep(1000);
      }
    }

    log("\n🎉 全曲の処理が完了しました");
  } catch (error) {
    log(`❌ エラー発生: ${error.message}`);
    throw error;
  } finally {
    restore();
  }
}
