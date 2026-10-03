import express from "express";
import cors from "cors";
import { prisma } from "./src/db.js";
import {
  getCurrentlyPlayingAlbum,
  getPlaybackState,
  resumePlayback,
  pausePlayback,
  skipToNext,
  skipToPrevious,
  playTrack,
} from "./src/spotify.js";
import { startWorker } from "./src/worker.js";
import { lemmatizeAndDefine, explainSpan } from "./src/vocab.js";
import { explainListeningDifficulty } from "./src/listening.js";
import {
  evaluateDictation,
  evaluateDictationGroups,
  explainDictationMistake,
} from "./src/dictation.js";
import { searchAlbums, getAlbumDetail, getAlbumTracks, getLyrics } from "./src/genius.js";
import { translateAndSaveTrack } from "./src/jobs.js";
import {
  OPENAI_API_KEY,
  GENIUS_ACCESS_TOKEN,
  VERCEL_REVALIDATE_URL,
  VERCEL_REVALIDATE_SECRET,
} from "./src/config.js";

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN; // 未設定なら全許可（個人利用のため）

app.use(cors(FRONTEND_ORIGIN ? { origin: FRONTEND_ORIGIN } : {}));
app.use(express.json());

/**
 * GET /healthz — Renderヘルスチェック用
 */
app.get("/healthz", (_req, res) => res.send("ok"));

/**
 * POST /api/jobs/from-spotify — 現在Spotifyで再生中のアルバムをジョブとして登録
 */
app.post("/api/jobs/from-spotify", async (_req, res) => {
  try {
    const current = await getCurrentlyPlayingAlbum();

    if (!current) {
      return res.status(404).json({ error: "再生中の曲がありません" });
    }

    const { artistName, albumName } = current;

    // 同一アルバムのジョブが既に進行中なら、それを返す（重複投入防止）
    const existingJob = await prisma.job.findFirst({
      where: {
        artistName,
        albumName,
        status: { in: ["pending", "running"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingJob) {
      return res.json({
        jobId: existingJob.id,
        artistName,
        albumName,
      });
    }

    const job = await prisma.job.create({
      data: {
        type: "album",
        artistName,
        albumName,
        status: "pending",
      },
    });

    res.json({ jobId: job.id, artistName, albumName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/genius/search-albums?q=... — Genius検索サジェストAPI経由でアルバム候補を返す
 * （フロントの入力補助用。DB書き込みなし・AI呼び出しなし）
 */
app.get("/api/genius/search-albums", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) {
      return res.json({ albums: [] });
    }

    const albums = await searchAlbums(q);
    res.json({ albums });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/genius/albums/:id/preview — 登録前確認用にアルバム情報とトラックリストを返す
 * （DB書き込みなし・AI呼び出しなし）
 */
app.get("/api/genius/albums/:id/preview", async (req, res) => {
  try {
    if (!GENIUS_ACCESS_TOKEN) {
      return res.status(500).json({ error: "GENIUS_ACCESS_TOKEN が設定されていません" });
    }

    const albumId = req.params.id;
    const [albumDetail, tracks] = await Promise.all([
      getAlbumDetail(albumId, GENIUS_ACCESS_TOKEN),
      getAlbumTracks(albumId, GENIUS_ACCESS_TOKEN),
    ]);

    if (!albumDetail) {
      return res.status(404).json({ error: "アルバムが見つかりません" });
    }

    res.json({ ...albumDetail, tracks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/jobs/from-genius — ユーザーが確認画面で選んだGeniusアルバムをジョブとして登録
 * body: { geniusAlbumId, artistName, albumName }
 */
app.post("/api/jobs/from-genius", async (req, res) => {
  try {
    const { geniusAlbumId, artistName, albumName } = req.body;

    if (!geniusAlbumId || !artistName || !albumName) {
      return res.status(400).json({ error: "geniusAlbumId / artistName / albumName は必須です" });
    }

    // 同一アルバムのジョブが既に進行中なら、それを返す（重複投入防止）
    const existingJob = await prisma.job.findFirst({
      where: {
        artistName,
        albumName,
        status: { in: ["pending", "running"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingJob) {
      return res.json({ jobId: existingJob.id, artistName, albumName });
    }

    const job = await prisma.job.create({
      data: {
        type: "album",
        artistName,
        albumName,
        status: "pending",
        geniusAlbumId: String(geniusAlbumId),
      },
    });

    res.json({ jobId: job.id, artistName, albumName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const retryingTrackIds = new Set(); // 同一曲の二重実行防止

/**
 * POST /api/tracks/:id/retry-lyrics — 歌詞データが無い曲について、その曲単体で
 * 歌詞取得→対訳・解説生成をやり直す。歌詞が既にある曲には何もしない。
 */
app.post("/api/tracks/:id/retry-lyrics", async (req, res) => {
  const trackId = req.params.id;
  try {
    if (!GENIUS_ACCESS_TOKEN || !OPENAI_API_KEY) {
      return res.status(500).json({ error: "APIキーが設定されていません" });
    }

    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: { album: true, _count: { select: { translations: true } } },
    });
    if (!track) return res.status(404).json({ error: "曲が見つかりません" });
    if (track._count.translations > 0) {
      return res.status(409).json({ error: "この曲には既に歌詞データがあります" });
    }
    if (retryingTrackIds.has(trackId)) {
      return res.status(409).json({ error: "この曲は取得処理中です" });
    }

    retryingTrackIds.add(trackId);
    try {
      const lyrics = await getLyrics(track.album.artistName, track.title, GENIUS_ACCESS_TOKEN);
      const { success } = await translateAndSaveTrack({
        createdTrack: track,
        lyrics,
        artistName: track.album.artistName,
        trackTitle: track.title,
      });

      if (!success) {
        return res.status(404).json({ error: "歌詞を取得できませんでした。しばらくしてからもう一度お試しください" });
      }

      if (VERCEL_REVALIDATE_URL) {
        for (const path of [`/tracks/${trackId}`, `/albums/${track.albumId}`]) {
          await fetch(VERCEL_REVALIDATE_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${VERCEL_REVALIDATE_SECRET}`,
            },
            body: JSON.stringify({ path }),
          }).catch(() => {});
        }
      }
      res.json({ ok: true });
    } finally {
      retryingTrackIds.delete(trackId);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/jobs/:id — ジョブの状態確認（フロントがポーリング）
 */
app.get("/api/jobs/:id", async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });

  if (!job) {
    return res.status(404).json({ error: "ジョブが見つかりません" });
  }

  res.json({
    status: job.status,
    progressLog: job.progressLog,
    errorMessage: job.errorMessage,
    albumId: job.albumId,
    totalTracks: job.totalTracks,
    completedTracks: job.completedTracks,
    costUsd: job.costUsd,
  });
});

/**
 * POST /api/vocab/preview — 登録前に内容（意味・品詞・CEFR）をプレビュー取得する。
 * DBへの書き込みは行わない（既存語彙があればそれを返し、新規語彙はAIで下調べのみ行う）。
 * body: { term, isPhrase, trackId, lineIndex }
 */
app.post("/api/vocab/preview", async (req, res) => {
  try {
    const { term, isPhrase, trackId, lineIndex } = req.body;

    if (!term || typeof term !== "string" || !trackId || typeof lineIndex !== "number") {
      return res.status(400).json({ error: "term / trackId / lineIndex は必須です" });
    }

    const line = await prisma.translation.findFirst({
      where: { trackId, lineIndex },
    });
    if (!line) {
      return res.status(404).json({ error: "対象の行が見つかりません" });
    }

    const rawTerm = term.trim();
    const rawIsPhrase = Boolean(isPhrase);
    const rawLowered = rawTerm.toLowerCase();

    const existing = await prisma.vocabEntry.findUnique({
      where: { term_isPhrase: { term: rawLowered, isPhrase: rawIsPhrase } },
    });

    if (existing) {
      return res.json({
        term: existing.term,
        meaning: existing.meaning,
        partOfSpeech: existing.partOfSpeech,
        cefr: existing.cefr,
        ipa: existing.ipa,
        isExisting: true,
        costUsd: 0,
      });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY が設定されていません" });
    }

    const result = await lemmatizeAndDefine(
      {
        term: rawTerm,
        isPhrase: rawIsPhrase,
        lineOriginal: line.original,
        lineTranslation: line.translation,
      },
      OPENAI_API_KEY
    );

    // AIが返した正規化後の語で再検索（別の表記から同じ語彙に辿り着く場合）
    const normalizedExisting = await prisma.vocabEntry.findUnique({
      where: { term_isPhrase: { term: result.term.toLowerCase(), isPhrase: rawIsPhrase } },
    });

    if (normalizedExisting) {
      return res.json({
        term: normalizedExisting.term,
        meaning: normalizedExisting.meaning,
        partOfSpeech: normalizedExisting.partOfSpeech,
        cefr: normalizedExisting.cefr,
        ipa: normalizedExisting.ipa,
        isExisting: true,
        costUsd: result.costUsd,
      });
    }

    res.json({
      term: result.term,
      meaning: result.meaning,
      partOfSpeech: result.partOfSpeech,
      cefr: result.cefr,
      ipa: result.ipa,
      isExisting: false,
      costUsd: result.costUsd,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/vocab/register — 単語帳への登録を確定する（同一語彙は再登録せず出現だけ追加）。
 * meaning/partOfSpeech/cefrが渡された場合はプレビュー済みとみなしAI呼び出しをスキップする。
 * body: { term, isPhrase, trackId, lineIndex, meaning?, partOfSpeech?, cefr?, ipa?, explanation? }
 */
app.post("/api/vocab/register", async (req, res) => {
  try {
    const {
      term,
      isPhrase,
      trackId,
      lineIndex,
      meaning: previewedMeaning,
      partOfSpeech: previewedPos,
      cefr: previewedCefr,
      ipa: previewedIpa,
      explanation,
    } = req.body;

    if (!term || typeof term !== "string" || !trackId || typeof lineIndex !== "number") {
      return res.status(400).json({ error: "term / trackId / lineIndex は必須です" });
    }

    const line = await prisma.translation.findFirst({
      where: { trackId, lineIndex },
    });
    if (!line) {
      return res.status(404).json({ error: "対象の行が見つかりません" });
    }

    const rawTerm = term.trim();
    const rawIsPhrase = Boolean(isPhrase);
    const rawLowered = rawTerm.toLowerCase();

    // 完全一致の既存登録があればAI呼び出しをスキップ
    let vocabEntry = await prisma.vocabEntry.findUnique({
      where: { term_isPhrase: { term: rawLowered, isPhrase: rawIsPhrase } },
    });
    let costUsd = 0;
    let meaning, partOfSpeech, cefr, ipa;
    let isNewEntry = false;

    if (vocabEntry) {
      meaning = vocabEntry.meaning;
      partOfSpeech = vocabEntry.partOfSpeech;
      cefr = vocabEntry.cefr;
      ipa = vocabEntry.ipa;

      // プレビュー時点でなかった解説が今回渡されたら追記する
      if (explanation && !vocabEntry.explanation) {
        vocabEntry = await prisma.vocabEntry.update({
          where: { id: vocabEntry.id },
          data: { explanation },
        });
      }
    } else if (previewedMeaning) {
      // プレビュー済み：AIを再度呼ばずそのまま作成する
      vocabEntry = await prisma.vocabEntry.create({
        data: {
          term: rawLowered,
          surfaceForm: rawTerm,
          isPhrase: rawIsPhrase,
          meaning: previewedMeaning,
          partOfSpeech: previewedPos ?? null,
          cefr: previewedCefr ?? null,
          ipa: previewedIpa ?? null,
          explanation: explanation ?? null,
          sourceTrackId: trackId,
          sourceLineIndex: lineIndex,
        },
      });
      meaning = previewedMeaning;
      partOfSpeech = previewedPos ?? null;
      cefr = previewedCefr ?? null;
      ipa = previewedIpa ?? null;
      isNewEntry = true;
    } else {
      // プレビューを経ていない直接呼び出し（フォールバック）
      if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: "OPENAI_API_KEY が設定されていません" });
      }

      const result = await lemmatizeAndDefine(
        {
          term: rawTerm,
          isPhrase: rawIsPhrase,
          lineOriginal: line.original,
          lineTranslation: line.translation,
        },
        OPENAI_API_KEY
      );
      costUsd = result.costUsd;
      meaning = result.meaning;
      partOfSpeech = result.partOfSpeech;
      cefr = result.cefr;
      ipa = result.ipa;

      const normalizedTerm = result.term.toLowerCase();

      vocabEntry = await prisma.vocabEntry.findUnique({
        where: { term_isPhrase: { term: normalizedTerm, isPhrase: rawIsPhrase } },
      });

      if (!vocabEntry) {
        vocabEntry = await prisma.vocabEntry.create({
          data: {
            term: normalizedTerm,
            surfaceForm: rawTerm,
            isPhrase: rawIsPhrase,
            meaning,
            partOfSpeech,
            cefr,
            ipa,
            explanation: explanation ?? null,
            sourceTrackId: trackId,
            sourceLineIndex: lineIndex,
          },
        });
        isNewEntry = true;
      }
    }

    await prisma.vocabOccurrence.upsert({
      where: {
        vocabEntryId_trackId_lineIndex: {
          vocabEntryId: vocabEntry.id,
          trackId,
          lineIndex,
        },
      },
      update: {},
      create: { vocabEntryId: vocabEntry.id, trackId, lineIndex },
    });

    res.json({
      vocabEntryId: vocabEntry.id,
      term: vocabEntry.term,
      meaning,
      partOfSpeech,
      cefr,
      ipa,
      explanation: vocabEntry.explanation,
      isNewEntry,
      costUsd,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/vocab/:vocabEntryId — 単語帳からエントリを削除（全出現・ハイライトも消える）
 */
app.delete("/api/vocab/:vocabEntryId", async (req, res) => {
  try {
    const { vocabEntryId } = req.params;

    const existing = await prisma.vocabEntry.findUnique({ where: { id: vocabEntryId } });
    if (!existing) {
      return res.status(404).json({ error: "対象の語彙が見つかりません" });
    }

    await prisma.vocabOccurrence.deleteMany({ where: { vocabEntryId } });
    await prisma.vocabEntry.delete({ where: { id: vocabEntryId } });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/vocab/explain — 選択範囲がなぜその訳になるのかをAIで解説（結果はキャッシュ）
 * body: { trackId, lineIndex, selectedText }
 */
app.post("/api/vocab/explain", async (req, res) => {
  try {
    const { trackId, lineIndex, selectedText } = req.body;

    if (!trackId || typeof lineIndex !== "number" || !selectedText) {
      return res.status(400).json({ error: "trackId / lineIndex / selectedText は必須です" });
    }

    const cached = await prisma.spanExplanation.findUnique({
      where: {
        trackId_lineIndex_selectedText: { trackId, lineIndex, selectedText },
      },
    });

    if (cached) {
      return res.json({ explanation: cached.explanation, costUsd: 0, cached: true });
    }

    const line = await prisma.translation.findFirst({
      where: { trackId, lineIndex },
    });
    if (!line) {
      return res.status(404).json({ error: "対象の行が見つかりません" });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY が設定されていません" });
    }

    const { explanation, costUsd } = await explainSpan(
      { selectedText, lineOriginal: line.original, lineTranslation: line.translation },
      OPENAI_API_KEY
    );

    await prisma.spanExplanation.create({
      data: { trackId, lineIndex, selectedText, explanation },
    });

    res.json({ explanation, costUsd, cached: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/spotify/state — 現在の再生状態を返す（フロントのリモコンUIがポーリング）
 */
app.get("/api/spotify/state", async (_req, res) => {
  try {
    const state = await getPlaybackState();
    res.json(
      state ?? {
        isPlaying: false,
        trackName: null,
        artistName: null,
        albumArtUrl: null,
        progressMs: null,
        durationMs: null,
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/spotify/play, /pause, /next, /previous — Spotify再生をリモート操作
 */
app.post("/api/spotify/play", async (_req, res) => {
  try {
    await resumePlayback();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/spotify/pause", async (_req, res) => {
  try {
    await pausePlayback();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/spotify/next", async (_req, res) => {
  try {
    await skipToNext();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/spotify/previous", async (_req, res) => {
  try {
    await skipToPrevious();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/spotify/play-track — このアプリの楽曲ページで開いている曲を、アルバムcontext付きで
 * Spotify上で再生開始する（曲が終われば通常のアルバム再生同様に次の曲へ自動継続する）
 * body: { trackId }
 */
app.post("/api/spotify/play-track", async (req, res) => {
  try {
    const { trackId } = req.body;
    if (!trackId) {
      return res.status(400).json({ error: "trackId は必須です" });
    }

    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: { album: true },
    });
    if (!track) {
      return res.status(404).json({ error: "対象の曲が見つかりません" });
    }

    await playTrack(track.album.artistName, track.album.albumTitle, track.title);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/listening/mark — 行の「聞き取れなかった」マークをトグルする
 * body: { trackId, lineIndex }
 */
app.post("/api/listening/mark", async (req, res) => {
  try {
    const { trackId, lineIndex } = req.body;
    if (!trackId || typeof lineIndex !== "number") {
      return res.status(400).json({ error: "trackId / lineIndex は必須です" });
    }

    const existing = await prisma.listeningMark.findUnique({
      where: { trackId_lineIndex: { trackId, lineIndex } },
    });

    if (existing) {
      await prisma.listeningMark.delete({ where: { id: existing.id } });
      return res.json({ marked: false });
    }

    await prisma.listeningMark.create({ data: { trackId, lineIndex } });
    res.json({ marked: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/listening/explain — マークした行について、聞き取りにくい音声変化パターンをAIで解説（結果はキャッシュ）
 * body: { trackId, lineIndex }
 */
app.post("/api/listening/explain", async (req, res) => {
  try {
    const { trackId, lineIndex } = req.body;
    if (!trackId || typeof lineIndex !== "number") {
      return res.status(400).json({ error: "trackId / lineIndex は必須です" });
    }

    const mark = await prisma.listeningMark.findUnique({
      where: { trackId_lineIndex: { trackId, lineIndex } },
    });
    if (!mark) {
      return res.status(404).json({ error: "この行はマークされていません" });
    }

    if (mark.explanation) {
      return res.json({ explanation: mark.explanation, costUsd: 0, cached: true });
    }

    const line = await prisma.translation.findFirst({ where: { trackId, lineIndex } });
    if (!line) {
      return res.status(404).json({ error: "対象の行が見つかりません" });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY が設定されていません" });
    }

    const { explanation, costUsd } = await explainListeningDifficulty(
      { lineOriginal: line.original, lineTranslation: line.translation },
      OPENAI_API_KEY
    );

    await prisma.listeningMark.update({
      where: { id: mark.id },
      data: { explanation },
    });

    res.json({ explanation, costUsd, cached: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/dictation/attempts — 書き取りテキストを歌詞と照合して採点し、結果を保存する
 * body は次のいずれか:
 *  - { trackId, text }                      曲全体を通して書いたテキストを採点する
 *  - { trackId, groups: [{lineIndexes, text}] }  連続した数行の区間ごとに入力されたテキストを、
 *                                               対応する区間とだけ照合する（再挑戦用）。旧形式の lineTexts も受け付ける
 */
app.post("/api/dictation/attempts", async (req, res) => {
  try {
    const { trackId, text, groups, lineTexts } = req.body;
    if (!trackId) {
      return res.status(400).json({ error: "trackId は必須です" });
    }

    const allLines = await prisma.translation.findMany({
      where: { trackId },
      orderBy: { lineIndex: "asc" },
      select: { lineIndex: true, original: true },
    });
    if (allLines.length === 0) {
      return res.status(404).json({ error: "この曲の歌詞データがありません" });
    }

    let result;
    let savedText;
    let scopeLines;

    if (groups !== undefined || lineTexts !== undefined) {
      // 旧形式 lineTexts（1行ずつの入力）は、1行だけの区間として扱う
      const rawGroups =
        groups ??
        (Array.isArray(lineTexts)
          ? lineTexts.map((e) => ({ lineIndexes: [e?.lineIndex], text: e?.text }))
          : null);
      if (
        !Array.isArray(rawGroups) ||
        !rawGroups.every(
          (g) =>
            g &&
            typeof g.text === "string" &&
            Array.isArray(g.lineIndexes) &&
            g.lineIndexes.length > 0 &&
            g.lineIndexes.every((n) => Number.isInteger(n))
        )
      ) {
        return res.status(400).json({ error: "groups が不正です" });
      }
      const originalByIndex = new Map(allLines.map((l) => [l.lineIndex, l.original]));
      // 入力が空の区間は「挑戦しなかった区間」として対象から外す
      const evaluatedGroups = rawGroups
        .filter((g) => g.text.trim())
        .map((g) => ({
          lines: [...new Set(g.lineIndexes)]
            .filter((n) => originalByIndex.has(n))
            .sort((a, b) => a - b)
            .map((n) => ({ lineIndex: n, original: originalByIndex.get(n) })),
          text: g.text.slice(0, 5000),
        }))
        .filter((g) => g.lines.length > 0)
        .sort((a, b) => a.lines[0].lineIndex - b.lines[0].lineIndex);
      if (evaluatedGroups.length === 0) {
        return res.status(400).json({ error: "入力された行がありません" });
      }
      result = evaluateDictationGroups(evaluatedGroups);
      savedText = evaluatedGroups.map((g) => g.text).join("\n");
      scopeLines = evaluatedGroups.flatMap((g) => g.lines.map((l) => l.lineIndex));
    } else {
      if (typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ error: "text は必須です" });
      }
      if (text.length > 20000) {
        return res.status(400).json({ error: "テキストが長すぎます" });
      }
      result = evaluateDictation(allLines, text);
      savedText = text;
    }

    const attempt = await prisma.dictationAttempt.create({
      data: {
        trackId,
        text: savedText,
        scopeLines,
        accuracy: result.summary.accuracy,
        totalWords: result.summary.total,
        gapCount: result.summary.gapMarks,
        result,
      },
    });

    res.json({
      id: attempt.id,
      createdAt: attempt.createdAt,
      text: attempt.text,
      scopeLines: attempt.scopeLines,
      accuracy: attempt.accuracy,
      totalWords: attempt.totalWords,
      gapCount: attempt.gapCount,
      result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/dictation/explain — 書き取りで間違えた行について、原因をAIで解説する（結果は試行の result に保存）
 * body: { attemptId, lineIndex }
 */
app.post("/api/dictation/explain", async (req, res) => {
  try {
    const { attemptId, lineIndex } = req.body;
    if (!attemptId || typeof lineIndex !== "number") {
      return res.status(400).json({ error: "attemptId / lineIndex は必須です" });
    }

    const attempt = await prisma.dictationAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) {
      return res.status(404).json({ error: "書き取りの記録が見つかりません" });
    }
    const result = attempt.result;
    const resultLine = result.lines.find((l) => l.lineIndex === lineIndex);
    if (!resultLine) {
      return res.status(404).json({ error: "対象の行が見つかりません" });
    }
    // 文法判定が追加される前に解説済みの行（grammar なし）は、再生成して文法判定を補う
    if (resultLine.explanation && resultLine.grammar) {
      return res.json({
        explanation: resultLine.explanation,
        grammar: resultLine.grammar,
        costUsd: 0,
        cached: true,
      });
    }

    const mistakes = resultLine.items.filter(
      (i) => i.status !== "match" && i.status !== "optional"
    );
    if (mistakes.length === 0) {
      return res.status(400).json({ error: "この行に間違いはありません" });
    }

    const line = await prisma.translation.findFirst({
      where: { trackId: attempt.trackId, lineIndex },
    });
    if (!line) {
      return res.status(404).json({ error: "対象の行が見つかりません" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY が設定されていません" });
    }

    const { explanation, grammar, costUsd } = await explainDictationMistake(
      {
        lineOriginal: line.original,
        lineTranslation: line.translation,
        mistakes: mistakes.map(({ ref, user, status }) => ({ ref, user, status })),
      },
      OPENAI_API_KEY
    );

    resultLine.explanation = explanation;
    resultLine.grammar = grammar;
    await prisma.dictationAttempt.update({
      where: { id: attempt.id },
      data: { result },
    });

    res.json({ explanation, grammar, costUsd, cached: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/spotify/now-playing-match —今Spotifyで流れている曲が、このアプリのDBに存在するか照合する
 * （右下固定ボタン用。存在すればそのtrackIdと表示用情報を返す）
 */
app.get("/api/spotify/now-playing-match", async (_req, res) => {
  try {
    const state = await getPlaybackState();
    if (!state || !state.trackName || !state.artistName) {
      return res.json({ trackId: null });
    }

    const normalize = (s) => s.toLowerCase().trim();
    const targetTitle = normalize(state.trackName);

    const candidates = await prisma.track.findMany({
      where: { album: { artistName: { equals: state.artistName, mode: "insensitive" } } },
      include: { album: true },
    });

    const match =
      candidates.find((t) => normalize(t.title) === targetTitle) ??
      candidates.find(
        (t) =>
          normalize(t.title).includes(targetTitle) ||
          targetTitle.includes(normalize(t.title))
      );

    if (!match) {
      return res.json({ trackId: null });
    }

    res.json({
      trackId: match.id,
      title: match.title,
      artistName: match.album.artistName,
      albumArtUrl: match.album.coverArtUrl,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  startWorker();
});
