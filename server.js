import express from "express";
import { processAlbum, processTracks } from "./src/jobs.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 実行中ジョブの管理（同時1ジョブ制限）
let currentJob = null;

app.use(express.static(join(__dirname, "public")));

/**
 * SSE ヘルパー: レスポンスをSSEモードに設定し、log関数を返す
 */
function setupSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const log = (msg) => send("log", { message: msg });

  return { send, log };
}

/**
 * GET /api/status — 実行中ジョブの有無
 */
app.get("/api/status", (_req, res) => {
  res.json({ busy: currentJob !== null, job: currentJob });
});

/**
 * GET /api/album?artist=...&album=... — SSEでアルバム処理
 */
app.get("/api/album", async (req, res) => {
  const { artist, album } = req.query;

  if (!artist || !album) {
    return res.status(400).json({ error: "artist と album パラメータが必要です" });
  }

  if (currentJob) {
    return res.status(409).json({ error: "別のジョブが実行中です" });
  }

  currentJob = { type: "album", artist, album, startedAt: new Date().toISOString() };
  const { send, log } = setupSSE(res);

  req.on("close", () => {
    // クライアント切断時もジョブは継続（console.logキャプチャの都合）
  });

  try {
    await processAlbum(artist, album, log);
    send("done", { success: true });
  } catch (error) {
    send("error", { message: error.message });
  } finally {
    currentJob = null;
    res.end();
  }
});

/**
 * GET /api/tracks?artist=...&tracks=[...] — SSEでトラック処理
 */
app.get("/api/tracks", async (req, res) => {
  const { artist, tracks: tracksJson } = req.query;

  if (!artist || !tracksJson) {
    return res.status(400).json({ error: "artist と tracks パラメータが必要です" });
  }

  let tracks;
  try {
    tracks = JSON.parse(tracksJson);
  } catch {
    return res.status(400).json({ error: "tracks が正しいJSON形式ではありません" });
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: "tracks は1つ以上の要素を持つ配列が必要です" });
  }

  if (currentJob) {
    return res.status(409).json({ error: "別のジョブが実行中です" });
  }

  currentJob = { type: "tracks", artist, trackCount: tracks.length, startedAt: new Date().toISOString() };
  const { send, log } = setupSSE(res);

  req.on("close", () => {});

  try {
    await processTracks(artist, tracks, log);
    send("done", { success: true });
  } catch (error) {
    send("error", { message: error.message });
  } finally {
    currentJob = null;
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
