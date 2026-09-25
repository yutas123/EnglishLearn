/**
 * Geniusのセクション見出し原文（例: "Verse 1: Paul McCartney & John Lennon"）を
 * 表示用に分解する。コロンが無い場合（例: "Chorus"）は歌手情報なしとして扱う。
 */
export type ParsedSection = {
  sectionType: string;
  performers: string[];
};

export function parseSectionLabel(raw: string): ParsedSection {
  const colonIndex = raw.indexOf(":");
  if (colonIndex === -1) {
    return { sectionType: raw.trim(), performers: [] };
  }

  const sectionType = raw.slice(0, colonIndex).trim() || raw.trim();
  const performersRaw = raw.slice(colonIndex + 1).trim();
  const performers = performersRaw
    .split(/,|&|\band\b/i)
    .map((p) => p.trim())
    .filter(Boolean);

  return { sectionType, performers };
}

// 既存のハイライト配色（emerald=登録済み語彙, sky=難所, red=削除）と被らない配色のみを使用
const BADGE_COLORS = [
  "bg-violet-100 text-violet-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-indigo-100 text-indigo-700",
  "bg-orange-100 text-orange-700",
  "bg-teal-100 text-teal-700",
  "bg-pink-100 text-pink-700",
  "bg-lime-100 text-lime-700",
  "bg-cyan-100 text-cyan-700",
];

/**
 * 歌手名から色を決定的に割り当てる（同じ名前は常に同じ色になる）
 */
export function colorForPerformer(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return BADGE_COLORS[hash % BADGE_COLORS.length];
}
