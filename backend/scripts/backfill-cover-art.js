// coverArtUrlが未設定の既存アルバムに対して、ジャケット画像を取得して埋める一回限りのスクリプト。
// 使い方: node scripts/backfill-cover-art.js
import { prisma } from "../src/db.js";
import { getCoverArtUrl } from "../src/coverArt.js";
import { VERCEL_REVALIDATE_URL, VERCEL_REVALIDATE_SECRET } from "../src/config.js";

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
    console.log(`⚠️ Vercel revalidate通知に失敗（${albumId}）: ${error.message}`);
  }
}

async function main() {
  const albums = await prisma.album.findMany({ where: { coverArtUrl: null } });
  console.log(`🔍 ジャケット画像未設定のアルバム: ${albums.length}件`);

  for (const album of albums) {
    console.log(`\n--- ${album.artistName} - ${album.albumTitle} ---`);
    const coverArtUrl = await getCoverArtUrl({
      artistName: album.artistName,
      albumTitle: album.albumTitle,
      releaseId: album.releaseId,
      releaseGroupId: null,
    });

    if (!coverArtUrl) {
      console.log("⚠️ 見つかりませんでした");
      continue;
    }

    await prisma.album.update({ where: { id: album.id }, data: { coverArtUrl } });
    await notifyRevalidate(album.id);
    console.log(`✅ 更新しました: ${coverArtUrl}`);
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("❌ 失敗:", error);
  await prisma.$disconnect();
  process.exit(1);
});
