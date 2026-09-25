import { searchRelease, getTrackList } from "./musicbrainz.js";
import { getLyrics, getAlbumUrl, getLyricsFromUrl, getAlbumDetail, getAlbumTracks } from "./genius.js";
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
 * 1曲分の歌詞取得後の処理（対訳生成・楽曲解説生成・DB保存）を行う共通ヘルパー。
 * processAlbum（MusicBrainz経由）とprocessAlbumFromGenius（Genius手動選択経由）の
 * 両方から使う。歌詞の取得方法だけが異なり、それ以降の処理は共通のため。
 * @returns {{ trackCostUsd: number, success: boolean }}
 */
async function translateAndSaveTrack({ createdTrack, lyrics, artistName, trackTitle }) {
  if (!lyrics || lyrics.lines.length === 0) {
    return { trackCostUsd: 0, success: false };
  }

  const { lines, sectionByLine } = lyrics;
  let trackCostUsd = 0;

  const { translations, costUsd: translateCost } = await translateLyrics(lines, OPENAI_API_KEY);
  trackCostUsd += translateCost;

  await prisma.translation.createMany({
    data: translations.map((t, i) => ({
      trackId: createdTrack.id,
      lineIndex: i,
      original: t.original,
      translation: t.translation,
      explanation: t.explanation || null,
      hardSpans: t.hardSpans?.length ? t.hardSpans : null,
      sectionLabel: sectionByLine[i] || null,
    })),
  });

  const { analysis, costUsd: analysisCost } = await generateSongAnalysis(
    lines,
    trackTitle,
    artistName,
    OPENAI_API_KEY
  );
  trackCostUsd += analysisCost;

  if (analysis) {
    await prisma.track.update({ where: { id: createdTrack.id }, data: { analysis } });
  }

  return { trackCostUsd, success: true };
}

/**
 * トラック一覧を並列処理し、各曲の歌詞取得（呼び出し元から渡された方法で）→対訳・解説生成→
 * DB保存→進捗更新までを行う共通ヘルパー。歌詞の取得方法（曲名検索 or URL直接指定）だけが
 * processAlbumとprocessAlbumFromGeniusで異なる。
 */
async function processTracks({ jobId, albumId, artistName, tracks, getLyricsForTrack }) {
  let completedCount = 0;
  let totalCostUsd = 0;

  await runWithConcurrency(tracks, TRACK_CONCURRENCY, async (track) => {
    const createdTrack = await prisma.track.create({
      data: { albumId, trackNo: track.trackNo, title: track.title },
    });

    const lyrics = await getLyricsForTrack(track);
    const { trackCostUsd, success } = await translateAndSaveTrack({
      createdTrack,
      lyrics,
      artistName,
      trackTitle: track.title,
    });
    const statusIcon = success ? "✅" : "⚠️";
    const statusNote = success ? "完了" : "歌詞なし";

    completedCount += 1;
    totalCostUsd += trackCostUsd;

    await updateJob(jobId, {
      completedTracks: completedCount,
      costUsd: totalCostUsd,
      progressLog: `${statusIcon} [${completedCount}/${tracks.length}] ${track.trackNo}. ${track.title}（${statusNote}）`,
    });
  });
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
    await processTracks({
      jobId,
      albumId: album.id,
      artistName,
      tracks,
      getLyricsForTrack: (track) => getLyrics(artistName, track.title, GENIUS_ACCESS_TOKEN),
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

/**
 * アルバム処理（Job単位、Genius手動選択経由）。
 * MusicBrainzを経由せず、ユーザーが確認画面で選んだGeniusアルバムのトラックリスト・曲URLを
 * そのまま使う。UK/US版など、MusicBrainzの「最古のオフィシャル版」選定では意図しない版に
 * なってしまうケースを、ユーザー自身の選択で回避するための経路。
 * @param {string} jobId - JobテーブルのID
 * @param {string} geniusAlbumId - GeniusのアルバムID
 */
export async function processAlbumFromGenius(jobId, geniusAlbumId) {
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

    await log(`🔍 Geniusアルバム情報取得中... (ID: ${geniusAlbumId})`);

    const [albumDetail, tracks] = await Promise.all([
      getAlbumDetail(geniusAlbumId, GENIUS_ACCESS_TOKEN),
      getAlbumTracks(geniusAlbumId, GENIUS_ACCESS_TOKEN),
    ]);

    if (!albumDetail) {
      throw new Error("Geniusアルバム情報が取得できませんでした");
    }
    if (!tracks || tracks.length === 0) {
      throw new Error("Geniusのトラックリストが空です");
    }

    const { artistName, name: albumTitle, coverArtUrl: geniusCoverArtUrl, url: geniusUrl } = albumDetail;
    await log(`🎯 アルバム確定: ${artistName} - ${albumTitle}`);

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

    await log(`🎧 ${tracks.length} 曲取得`);
    await updateJob(jobId, { totalTracks: tracks.length });

    // ジャケット画像はユーザーが確認画面で見た版と一致させるため、Genius提供のものを優先する
    const coverArtUrl = geniusCoverArtUrl ?? (await getCoverArtUrl({ artistName, albumTitle }));
    await log(coverArtUrl ? `🖼️ ジャケット画像を取得` : `⚠️ ジャケット画像が見つかりません`);

    const album = await prisma.album.create({
      data: { artistName, albumTitle, releaseId: null, coverArtUrl, geniusUrl },
    });
    await updateJob(jobId, { albumId: album.id });
    await log(`📀 アルバム作成完了: ${albumTitle}`);

    await processTracks({
      jobId,
      albumId: album.id,
      artistName,
      tracks,
      getLyricsForTrack: (track) => getLyricsFromUrl(track.url),
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
