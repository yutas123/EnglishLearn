import { addLyricsToPage, addSongAnalysisToPage } from "./src/notion.js";
import { getLyrics } from "./src/genius.js";
import { translateLyrics, generateSongAnalysis } from "./src/translator.js";
import { GENIUS_ACCESS_TOKEN, OPENAI_API_KEY } from "./src/config.js";

/**
 * ★ 入力はここだけ ★
 * エラーで失敗した曲を個別に再実行するためのスクリプト
 *
 * ARTIST_NAME: アーティスト名
 * TRACKS: 再実行したい曲の配列
 *   - title: 曲名（Genius検索用）
 *   - notionPageId: 既存のNotionトラックページID
 */
const ARTIST_NAME = "Elliott Smith";
const TRACKS = [
  {
    title: "Southern Belle",
    notionPageId: "2fdf43a6c5f881f2b94dc15de765a64d",
  },
  // 複数曲ある場合は追加
  // {
  //   title: "別の曲名",
  //   notionPageId: "別のページID",
  // },
];

async function main() {
  try {
    if (!GENIUS_ACCESS_TOKEN) {
      throw new Error("GENIUS_ACCESS_TOKEN が設定されていません");
    }
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY が設定されていません");
    }

    console.log(`🎵 楽曲単位の翻訳を開始 (${TRACKS.length} 曲)`);

    for (const track of TRACKS) {
      console.log(`\n  → 処理中: ${track.title}`);

      // 歌詞取得
      console.log(`    📝 歌詞を取得中...`);
      const lyrics = await getLyrics(
        ARTIST_NAME,
        track.title,
        GENIUS_ACCESS_TOKEN
      );

      if (!lyrics || lyrics.length === 0) {
        console.log(`    ⚠️ 歌詞が取得できませんでした: ${track.title}`);
        continue;
      }

      // 翻訳
      console.log(`    🌐 対訳を生成中... (${lyrics.length}行)`);
      const translations = await translateLyrics(lyrics, OPENAI_API_KEY);

      // Notionに歌詞追加
      console.log(`    📄 Notionに歌詞を追加中...`);
      await addLyricsToPage(track.notionPageId, translations);

      // 楽曲解説を生成・追加
      console.log(`    📖 楽曲解説を生成中...`);
      const analysis = await generateSongAnalysis(
        lyrics,
        track.title,
        ARTIST_NAME,
        OPENAI_API_KEY
      );
      if (analysis) {
        await addSongAnalysisToPage(track.notionPageId, analysis);
      }

      console.log(`    ✅ 完了: ${track.title}`);

      // API制限対策
      if (TRACKS.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log("\n🎉 全曲の処理が完了しました");
  } catch (error) {
    console.error("❌ エラー発生:", error.message);
  }
}

main();
