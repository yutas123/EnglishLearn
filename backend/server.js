import express from "express";
import cors from "cors";
import { prisma } from "./src/db.js";
import { getCurrentlyPlayingAlbum } from "./src/spotify.js";
import { startWorker } from "./src/worker.js";
import { lemmatizeAndDefine, explainSpan } from "./src/vocab.js";
import { searchAlbums, getAlbumDetail, getAlbumTracks } from "./src/genius.js";
import { OPENAI_API_KEY, GENIUS_ACCESS_TOKEN } from "./src/config.js";

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
        isExisting: true,
        costUsd: result.costUsd,
      });
    }

    res.json({
      term: result.term,
      meaning: result.meaning,
      partOfSpeech: result.partOfSpeech,
      cefr: result.cefr,
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
 * body: { term, isPhrase, trackId, lineIndex, meaning?, partOfSpeech?, cefr?, explanation? }
 */
app.post("/api/vocab/register", async (req, res) => {
  try {
    const { term, isPhrase, trackId, lineIndex, meaning: previewedMeaning, partOfSpeech: previewedPos, cefr: previewedCefr, explanation } = req.body;

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
          explanation: explanation ?? null,
          sourceTrackId: trackId,
          sourceLineIndex: lineIndex,
        },
      });
      meaning = previewedMeaning;
      partOfSpeech = previewedPos ?? null;
      cefr = previewedCefr ?? null;
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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  startWorker();
});
