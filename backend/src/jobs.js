import { searchRelease, getTrackList } from "./musicbrainz.js";
import { getLyrics, getAlbumUrl } from "./genius.js";
import { translateLyrics, generateSongAnalysis } from "./translator.js";
import { getCoverArtUrl } from "./coverArt.js";
import { GENIUS_ACCESS_TOKEN, OPENAI_API_KEY } from "./config.js";
import { prisma } from "./db.js";

// 同時に処理する曲数（Genius/ScraperAPI/OpenAIへの同時アクセス数を抑えつつ高速化）
const TRACK_CONCURRENCY = 3;

async function updateJob(jobId, data) {
  await prisma.job.update({ where: { id: jobId }, data });
}

/**
 * 配列を指定した同時実行数で処理する（結果の順序は保持しない）
 * @param {Array} items
 * @param {number} concurrency
 * @param {(item: any, index: number) => Promise<void>} worker
 */
async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;

  async function runNext() {
    const index = cursor++;
    if (index >= items.length) return;
    await worker(items[index], index);
    await runNext();
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runNext()
  );
  await Promise.all(runners);
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
    const { releaseId, releaseGroupId, albumTitle } = await searchRelease(artistName, albumName);
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
    await updateJob(jobId, { totalTracks: tracks.length });

    // ③ ジャケット画像・Geniusリンク取得
    const coverArtUrl = await getCoverArtUrl({ artistName, albumTitle, releaseId, releaseGroupId });
    await log(coverArtUrl ? `🖼️ ジャケット画像を取得` : `⚠️ ジャケット画像が見つかりません`);

    const geniusUrl = await getAlbumUrl(artistName, albumName, GENIUS_ACCESS_TOKEN);
    await log(geniusUrl ? `🔗 Geniusリンク取得完了: ${geniusUrl}` : `⚠️ Geniusアルバムリンクが見つかりませんでした`);

    // ④ アルバムをDBに作成
    const album = await prisma.album.create({
      data: { artistName, albumTitle, releaseId, coverArtUrl, geniusUrl },
    });
    await updateJob(jobId, { albumId: album.id });
    await log(`📀 アルバム作成完了: ${albumTitle}`);

    // ⑤ 各トラックを並列処理（同時TRACK_CONCURRENCY曲まで）+ 歌詞と対訳
    let completedCount = 0;
    let totalCostUsd = 0;

    await runWithConcurrency(tracks, TRACK_CONCURRENCY, async (track) => {
      const createdTrack = await prisma.track.create({
        data: { albumId: album.id, trackNo: track.trackNo, title: track.title },
      });

      const lyrics = await getLyrics(artistName, track.title, GENIUS_ACCESS_TOKEN);
      let trackCostUsd = 0;
      let statusIcon = "⚠️";
      let statusNote = "歌詞なし";

      if (lyrics && lyrics.length > 0) {
        const { translations, costUsd: translateCost } = await translateLyrics(
          lyrics,
          OPENAI_API_KEY
        );
        trackCostUsd += translateCost;

        await prisma.translation.createMany({
          data: translations.map((t, i) => ({
            trackId: createdTrack.id,
            lineIndex: i,
            original: t.original,
            translation: t.translation,
            explanation: t.explanation || null,
            hardSpans: t.hardSpans?.length ? t.hardSpans : null,
          })),
        });

        const { analysis, costUsd: analysisCost } = await generateSongAnalysis(
          lyrics,
          track.title,
          artistName,
          OPENAI_API_KEY
        );
        trackCostUsd += analysisCost;

        if (analysis) {
          await prisma.track.update({
            where: { id: createdTrack.id },
            data: { analysis },
          });
        }

        statusIcon = "✅";
        statusNote = "完了";
      }

      completedCount += 1;
      totalCostUsd += trackCostUsd;

      await updateJob(jobId, {
        completedTracks: completedCount,
        costUsd: totalCostUsd,
        progressLog: `${statusIcon} [${completedCount}/${tracks.length}] ${track.trackNo}. ${track.title}（${statusNote}）`,
      });
    });

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
