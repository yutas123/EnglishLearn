// data/beatles-credits.json の内容を、曲名が一致するビートルズの曲に書き込む。
// 既定はドライラン（DB書き込みなし）。実際に反映するときは --apply を付ける。
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/db.js";

const apply = process.argv.includes("--apply");
// --only="曲名1|曲名2" で対象の曲を絞れる（未指定なら json の全曲）
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice(7).split("|").map((x) => x.trim().toLowerCase())) : null;
const data = JSON.parse(readFileSync(new URL("../data/beatles-credits.json", import.meta.url), "utf8"));

// 引用符の種類や大文字小文字の違いを吸収して曲名を突き合わせる
const norm = (s) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s*\(remaster(ed)?.*\)$/, "").trim();

const tracks = await prisma.track.findMany({
  where: { album: { artistName: { contains: "Beatles" } } },
  select: {
    id: true,
    title: true,
    vocalOverrides: true,
    album: { select: { albumTitle: true } },
    translations: { select: { lineIndex: true, original: true, sectionLabel: true }, orderBy: { lineIndex: "asc" } },
  },
});
const byTitle = new Map();
for (const t of tracks) {
  const k = norm(t.title);
  byTitle.set(k, [...(byTitle.get(k) ?? []), t]);
}

// 括弧書き(コーラス)の部分だけ別の歌い手にする行単位の上書きを作る（画面側の resolveVoices / applyParenVoices と同じ考え方）。
// 上書きの線は、H(薄い線=ユニゾン)にならないよう全て L にし、既定の並び順に揃える
const ORDER = ["paul", "george", "john", "ringo"];
const asLead = (tokens) =>
  tokens
    .map((t) => t.replace(/^(\w+):[LH]/, "$1:L"))
    .sort((a, b) => ORDER.indexOf(a.split(":")[0]) - ORDER.indexOf(b.split(":")[0]));
function sectionTokens(parts, label) {
  const base = (label ?? "").split(":")[0].trim();
  for (const key of [base, base.replace(/\s*\d+$/, ""), "*"]) {
    if (key && Array.isArray(parts[key])) return parts[key];
  }
  return [];
}
function buildParenOverrides(c, lines) {
  const out = {};
  const inside = asLead(c.paren.voices);
  for (const line of lines) {
    const text = line.original;
    const ranges = [...text.matchAll(/\([^)]*\)|（[^）]*）/g)].map((m) => [m.index, m.index + m[0].length]);
    if (ranges.length === 0) continue;
    const base = (line.sectionLabel ?? "").split(":")[0].trim();
    if (c.paren.sections && !c.paren.sections.includes(base)) continue;
    const outside = asLead(sectionTokens(c.parts, line.sectionLabel));
    const cuts = [...new Set([...ranges.flat(), text.length])].filter((x) => x > 0).sort((a, b) => a - b);
    const parts = [];
    let start = 0;
    for (const end of cuts) {
      const v = ranges.some(([a, b]) => start >= a && end <= b) ? inside : outside;
      const last = parts[parts.length - 1];
      if (last && last.v.join() === v.join()) last.end = end;
      else parts.push({ end, v });
      start = end;
    }
    out[String(line.lineIndex)] = { parts };
  }
  return out;
}

let updated = 0;
const touchedIds = [];
for (const [title, c] of Object.entries(data)) {
  if (title.startsWith("_")) continue;
  if (only && !only.has(title.toLowerCase())) continue;
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
      touchedIds.push(t.id);
    }
    if (c.paren) {
      if (t.vocalOverrides) {
        console.log("   ⏭ 画面で編集済みの上書きがあるので括弧書きの上書きはスキップ");
      } else {
        const overrides = buildParenOverrides(c, t.translations);
        const n = Object.keys(overrides).length;
        console.log(`   括弧書きの上書き: ${n}行`);
        if (apply && n > 0) await prisma.track.update({ where: { id: t.id }, data: { vocalOverrides: overrides } });
      }
    }
    updated++;
  }
}
// 曲ページは静的生成されているので、反映後に再生成を依頼する
if (apply && process.env.VERCEL_REVALIDATE_URL) {
  for (const id of touchedIds) {
    await fetch(process.env.VERCEL_REVALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VERCEL_REVALIDATE_SECRET}` },
      body: JSON.stringify({ path: `/tracks/${id}` }),
    }).catch(() => {});
  }
}
console.log(`${updated}曲 ${apply ? "反映しました" : "が対象（ドライラン）"}`);
process.exit(0);
