import express from "express";
import cors from "cors";
import { prisma } from "./src/db.js";
import { getCurrentlyPlayingAlbum } from "./src/spotify.js";
import { startWorker } from "./src/worker.js";

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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  startWorker();
});
