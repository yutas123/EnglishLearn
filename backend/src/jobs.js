import { searchRelease, getTrackList } from "./musicbrainz.js";
import { getLyrics, getAlbumUrl } from "./genius.js";
import { translateLyrics, generateSongAnalysis } from "./translator.js";
import { GENIUS_ACCESS_TOKEN, OPENAI_API_KEY } from "./config.js";
import { prisma } from "./db.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cover Art Archiveからジャケット画像URLを取得（存在チェック付き）
 */
async function getCoverArtUrl(releaseId) {
  if (!releaseId) return null;
  const url = `https://coverartarchive.org/release/${releaseId}/front-250`;
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

async function updateJob(jobId, data) {
  await prisma.job.update({ where: { id: jobId }, data });
}

/**
 * アルバム処理（Job単位）
 * @param {string} jobId - JobテーブルのID
 * @param {string} artistName - アーティスト名
 * @param {string} albumName - アルバム名
 */
export async function processAlbum(jobId, artistName, albumName) {
  const log = async (msg) => {
    console.log(msg);
    await updateJob(jobId, { progressLog: msg }).catch(() => {});
  };

  try {
    await updateJob(jobId, { status: "running" });

    if (!GENIUS_ACCESS_TOKEN) {
      throw new Error("GENIUS_ACCESS_TOKEN が設定されていません");
    }
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY が設定されていません");
    }

    await log(`🔍 MusicBrainz 検索中: ${artistName} - ${albumName}`);

    // ① Release検索
    const { releaseId, albumTitle } = await searchRelease(artistName, albumName);
    await log(`🎯 Release確定: ${albumTitle} (ID: ${releaseId})`);

    // 既に同一アルバムが登録済みなら再生成せずそのまま完了扱いにする
    const existing = await prisma.album.findUnique({
      where: { artistName_albumTitle: { artistName, albumTitle } },
    });
    if (existing) {
      await updateJob(jobId, {
        status: "done",
        albumId: existing.id,
        progressLog: `✅ 既に登録済みのアルバムです: ${albumTitle}`,
      });
      return;
    }

    // ② トラック取得
    const tracks = await getTrackList(releaseId);
    await log(`🎧 ${tracks.length} 曲取得`);

    // ③ ジャケット画像・Geniusリンク取得
    const coverArtUrl = await getCoverArtUrl(releaseId);
    await log(coverArtUrl ? `🖼️ ジャケット画像を取得` : `⚠️ ジャケット画像が見つかりません`);

    const geniusUrl = await getAlbumUrl(artistName, albumName, GENIUS_ACCESS_TOKEN);
    await log(geniusUrl ? `🔗 Geniusリンク取得完了: ${geniusUrl}` : `⚠️ Geniusアルバムリンクが見つかりませんでした`);

    // ④ アルバムをDBに作成
    const album = await prisma.album.create({
      data: { artistName, albumTitle, releaseId, coverArtUrl, geniusUrl },
    });
    await updateJob(jobId, { albumId: album.id });
    await log(`📀 アルバム作成完了: ${albumTitle}`);

    // ⑤ 各トラックを登録 + 歌詞と対訳
    for (const track of tracks) {
      await log(`  → 登録中: ${track.trackNo}. ${track.title}`);

      const createdTrack = await prisma.track.create({
        data: { albumId: album.id, trackNo: track.trackNo, title: track.title },
      });

      await log(`    📝 歌詞を取得中...`);
      const lyrics = await getLyrics(artistName, track.title, GENIUS_ACCESS_TOKEN);

      if (lyrics && lyrics.length > 0) {
        await log(`    🌐 対訳を生成中... (${lyrics.length}行)`);
        const translations = await translateLyrics(lyrics, OPENAI_API_KEY);

        await prisma.translation.createMany({
          data: translations.map((t, i) => ({
            trackId: createdTrack.id,
            lineIndex: i,
            original: t.original,
            translation: t.translation,
            explanation: t.explanation || null,
          })),
        });

        await log(`    📖 楽曲解説を生成中...`);
        const analysis = await generateSongAnalysis(
          lyrics,
          track.title,
          artistName,
          OPENAI_API_KEY
        );
        if (analysis) {
          await prisma.track.update({
            where: { id: createdTrack.id },
            data: { analysis },
          });
        }

        await log(`    ✅ 完了`);
      } else {
        await log(`    ⚠️ 歌詞が取得できなかったためスキップ: ${track.title}`);
      }

      await sleep(1000);
    }

    await updateJob(jobId, {
      status: "done",
      progressLog: "🎉 完了！アルバムと全曲（歌詞付き）が登録されました",
    });
  } catch (error) {
    await updateJob(jobId, {
      status: "error",
      errorMessage: error.message,
      progressLog: `❌ エラー発生: ${error.message}`,
    }).catch(() => {});
    throw error;
  }
}
