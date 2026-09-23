import express from "express";
import cors from "cors";
import { prisma } from "./src/db.js";
import { getCurrentlyPlayingAlbum } from "./src/spotify.js";
import { startWorker } from "./src/worker.js";
import { lemmatizeAndDefine, explainSpan } from "./src/vocab.js";
import { OPENAI_API_KEY } from "./src/config.js";

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
 * POST /api/vocab/register — 選択した単語/熟語を単語帳に登録（同一語彙は再登録せず出現だけ追加）
 * body: { term, isPhrase, trackId, lineIndex }
 */
app.post("/api/vocab/register", async (req, res) => {
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

    // 完全一致の既存登録があればAI呼び出しをスキップ
    let vocabEntry = await prisma.vocabEntry.findUnique({
      where: { term_isPhrase: { term: rawLowered, isPhrase: rawIsPhrase } },
    });
    let costUsd = 0;
    let meaning, partOfSpeech, cefr;
    let isNewEntry = false;

    if (vocabEntry) {
      meaning = vocabEntry.meaning;
      partOfSpeech = vocabEntry.partOfSpeech;
      cefr = vocabEntry.cefr;
    } else {
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

      const normalizedTerm = result.term.toLowerCase();

      // AIが返した正規化後の語で再検索（別の表記から同じ語彙に辿り着く場合の重複防止）
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
      isNewEntry,
      costUsd,
    });
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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  startWorker();
});
