import { prisma } from "./db.js";
import { processAlbum, processAlbumFromGenius } from "./jobs.js";
import { VERCEL_REVALIDATE_URL, VERCEL_REVALIDATE_SECRET } from "./config.js";

const POLL_INTERVAL_MS = 5000;

let isProcessing = false;

/**
 * ジョブ完了時にVercel側のオンデマンド再生成エンドポイントを叩く
 */
async function notifyRevalidate(albumId) {
  if (!VERCEL_REVALIDATE_URL || !albumId) return;

  try {
    await fetch(VERCEL_REVALIDATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VERCEL_REVALIDATE_SECRET}`,
      },
      body: JSON.stringify({ path: `/albums/${albumId}` }),
    });
  } catch (error) {
    console.log(`⚠️ Vercel revalidate通知に失敗: ${error.message}`);
  }
}

async function tick() {
  if (isProcessing) return;

  const job = await prisma.job.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) return;

  isProcessing = true;
  try {
    if (job.geniusAlbumId) {
      await processAlbumFromGenius(job.id, job.geniusAlbumId);
    } else {
      await processAlbum(job.id, job.artistName, job.albumName);
    }

    const updated = await prisma.job.findUnique({ where: { id: job.id } });
    if (updated?.status === "done" && updated.albumId) {
      await notifyRevalidate(updated.albumId);
    }
  } catch (error) {
    // processAlbum内でJobはerror状態に更新済み。ここではログのみ。
    console.log(`⚠️ ジョブ ${job.id} が失敗しました: ${error.message}`);
  } finally {
    isProcessing = false;
  }
}

/**
 * pendingジョブを順次処理するポーリングループを開始（同時実行数1）
 */
export function startWorker() {
  setInterval(() => {
    tick().catch((error) => console.log(`⚠️ ワーカーループエラー: ${error.message}`));
  }, POLL_INTERVAL_MS);

  console.log(`👷 ワーカー起動（${POLL_INTERVAL_MS / 1000}秒間隔でポーリング）`);
}
