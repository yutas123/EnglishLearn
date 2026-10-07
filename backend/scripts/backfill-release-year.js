// releaseYearが未設定の既存アルバムに対して、リリース年を取得して埋める一回限りのスクリプト。
// Genius検索→アルバム詳細のrelease_date_componentsから取得し、取れなければMusicBrainzのリリース日を使う。
// 使い方: node scripts/backfill-release-year.js
import { prisma } from "../src/db.js";
import { GENIUS_ACCESS_TOKEN } from "../src/config.js";
import { parseReleaseYear } from "../src/musicbrainz.js";
import { searchAlbums, getAlbumDetail } from "../src/genius.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (s) => s.trim().toLowerCase();

async function yearFromMusicBrainz(releaseId) {
  const res = await fetch(`https://musicbrainz.org/ws/2/release/${releaseId}?fmt=json`, {
    headers: { "User-Agent": "notion-music-db/1.0 ( example@email.com )" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  await sleep(1100); // MusicBrainzは1リクエスト/秒の制限
  return parseReleaseYear(data.date);
}

async function yearFromGenius(album) {
  const candidates = await searchAlbums(`${album.artistName} ${album.albumTitle}`);
  const match = candidates.find(
    (c) =>
      normalize(c.name) === normalize(album.albumTitle) &&
      normalize(c.artistName) === normalize(album.artistName)
  );
  if (!match) return null;
  const detail = await getAlbumDetail(match.id, GENIUS_ACCESS_TOKEN);
  return detail?.releaseYear ?? null;
}

async function main() {
  const albums = await prisma.album.findMany({ where: { releaseYear: null } });
  console.log(`🔍 リリース年未設定のアルバム: ${albums.length}件`);

  for (const album of albums) {
    console.log(`\n--- ${album.artistName} - ${album.albumTitle} ---`);
    try {
      // MusicBrainz側は「最古のオフィシャル版」を選ぶ都合で再発盤の年になることがある（例: Pet Sounds→1972）
      // ため、オリジナルの発売日を持つGeniusを優先し、見つからなければMusicBrainzにフォールバックする
      let year = await yearFromGenius(album).catch(() => null);
      if (!year && album.releaseId) year = await yearFromMusicBrainz(album.releaseId);

      if (!year) {
        console.log("⚠️ 見つかりませんでした");
        continue;
      }
      await prisma.album.update({ where: { id: album.id }, data: { releaseYear: year } });
      console.log(`✅ ${year}`);
    } catch (error) {
      console.log(`⚠️ 取得に失敗: ${error.message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("❌ 失敗:", error);
  await prisma.$disconnect();
  process.exit(1);
});
