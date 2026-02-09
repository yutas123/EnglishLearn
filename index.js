import { searchRelease, getTrackList } from "./src/musicbrainz.js";
import { createAlbum, createTrack, addLyricsToPage, addTrackListToAlbum } from "./src/notion.js";
import { getLyrics } from "./src/genius.js";
import { translateLyrics } from "./src/translator.js";
import { GENIUS_ACCESS_TOKEN, OPENAI_API_KEY } from "./src/config.js";

/**
 * ★ 入力はここだけ ★
 */
const ARTIST_NAME = "The Kinks";
const ALBUM_NAME = "The Kinks are the Village Green Preservation Society";

async function main() {
  try {
    // APIキーの確認
    if (!GENIUS_ACCESS_TOKEN) {
      throw new Error("GENIUS_ACCESS_TOKEN が設定されていません");
    }
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY が設定されていません");
    }

    console.log(`🔍 MusicBrainz 検索中: ${ARTIST_NAME} - ${ALBUM_NAME}`);

    // ① Release検索
    const { releaseId, albumTitle } = await searchRelease(
      ARTIST_NAME,
      ALBUM_NAME
    );

    console.log(`🎯 Release確定: ${albumTitle}`);
    console.log(`🆔 Release ID: ${releaseId}`);

    // ② トラック取得
    const tracks = await getTrackList(releaseId);
    console.log(`🎧 ${tracks.length} 曲取得`);

    // ③ Notionにアルバム作成（ジャケット画像付き）
    console.log(`📀 アルバム作成中: ${albumTitle}`);
    const albumPageId = await createAlbum({ albumName: albumTitle, releaseId });
    console.log(`✅ アルバム作成完了 (ID: ${albumPageId})`);

    // ④ 各トラックをNotionに登録（アルバムにリレーション）+ 歌詞と対訳
    const createdTracks = []; // トラックリスト用に保存

    for (const track of tracks) {
      console.log(`  → 登録中: ${track.trackNo}. ${track.title}`);

      // トラック作成
      const trackPageId = await createTrack({
        title: track.title,
        trackNo: track.trackNo,
        albumPageId: albumPageId,
      });

      // トラックリスト用に保存
      createdTracks.push({
        trackNo: track.trackNo,
        title: track.title,
        pageId: trackPageId,
      });

      // 歌詞取得
      console.log(`    📝 歌詞を取得中...`);
      const lyrics = await getLyrics(
        ARTIST_NAME,
        track.title,
        GENIUS_ACCESS_TOKEN
      );

      if (lyrics && lyrics.length > 0) {
        console.log(`    🌐 対訳を生成中... (${lyrics.length}行)`);
        const translations = await translateLyrics(lyrics, OPENAI_API_KEY);

        console.log(`    📄 Notionに歌詞を追加中...`);
        await addLyricsToPage(trackPageId, translations);
        console.log(`    ✅ 完了`);
      }

      // API制限対策のため少し待機
      await sleep(1000);
    }

    // ⑤ アルバムページにトラックリストを追加
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
