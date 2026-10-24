// data/beatles-credits.json の内容を、曲名が一致するビートルズの曲に書き込む。
// 既定はドライラン（DB書き込みなし）。実際に反映するときは --apply を付ける。
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/db.js";

const apply = process.argv.includes("--apply");
const data = JSON.parse(readFileSync(new URL("../data/beatles-credits.json", import.meta.url), "utf8"));

// 引用符の種類や大文字小文字の違いを吸収して曲名を突き合わせる
const norm = (s) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s*\(remaster(ed)?.*\)$/, "").trim();

const tracks = await prisma.track.findMany({
  where: { album: { artistName: { contains: "Beatles" } } },
  select: { id: true, title: true, album: { select: { albumTitle: true } } },
});
const byTitle = new Map();
for (const t of tracks) {
  const k = norm(t.title);
  byTitle.set(k, [...(byTitle.get(k) ?? []), t]);
}

let updated = 0;
for (const [title, c] of Object.entries(data)) {
  if (title.startsWith("_")) continue;
  const hits = byTitle.get(norm(title)) ?? [];
  if (hits.length === 0) {
    console.log(`⚠️ DBに曲が見つからない: ${title}`);
    continue;
  }
  for (const t of hits) {
    console.log(`${apply ? "✏️" : "👀"} ${t.album.albumTitle} / ${t.title}${c.check ? " " : ""}`);
    if (apply) {
      await prisma.track.update({
        where: { id: t.id },
        data: { songwriterNote: c.writer ?? null, leadVocalNote: c.lead ?? null, vocalParts: c.parts ?? null },
      });
    }
    updated++;
  }
}
console.log(`${updated}曲 ${apply ? "反映しました" : "が対象（ドライラン）"}`);
process.exit(0);
