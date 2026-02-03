import { searchRelease, getTrackList } from "./src/musicbrainz.js";
import { createAlbum, createTrack } from "./src/notion.js";

/**
 * ★ 入力はここだけ ★
 */
const ARTIST_NAME = "The Cure";
const ALBUM_NAME = "Seventeen Seconds";

async function main() {
  try {
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

    // ③ Notionにアルバム作成
    console.log(`📀 アルバム作成中: ${albumTitle}`);
    const albumPageId = await createAlbum({ albumName: albumTitle });
    console.log(`✅ アルバム作成完了 (ID: ${albumPageId})`);

    // ④ 各トラックをNotionに登録（アルバムにリレーション）
    for (const track of tracks) {
      console.log(`  → 登録中: ${track.trackNo}. ${track.title}`);
      await createTrack({
        title: track.title,
        trackNo: track.trackNo,
        albumPageId: albumPageId,
      });
    }

    console.log("🎉 完了！アルバムと全曲がNotionに登録されました");
  } catch (error) {
    console.error("❌ エラー発生:", error.message);
  }
}

main();
