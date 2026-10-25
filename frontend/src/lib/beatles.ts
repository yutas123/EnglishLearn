// ビートルズ曲の「誰が歌っているか」表示用ヘルパー。
// Track.vocalParts は { "Verse 1": ["john:L", "paul:B"], "*": [...] } 形式（配列順＝音程の高い順）。

export const MEMBERS = {
  john: { name: "John", color: "#3b82f6" },
  paul: { name: "Paul", color: "#ef4444" },
  george: { name: "George", color: "#22c55e" },
  ringo: { name: "Ringo", color: "#f59e0b" },
} as const;

export type MemberKey = keyof typeof MEMBERS;

// 'john:L' / 'paul:H' / 'john:L:2'（末尾の2=ダブルトラック）。L=濃い線（1本ならリード、2本以上ならハモリ）、H=薄い線（ユニゾン）。コーラス/掛け合いは線を引かないのでデータに含めない
// double=true はダブルトラック（同じ人の声を重ね録りしている）。同色の二重線で描く
export type Voice = { member: MemberKey; role: "L" | "H"; double: boolean };

function parseVoice(token: string): Voice | null {
  const [member, role, flag] = token.split(":");
  if (!(member in MEMBERS)) return null;
  return { member: member as MemberKey, role: role === "H" ? "H" : "L", double: flag === "2" };
}

/**
 * セクション見出し（"Verse 1: Paul McCartney & ..." の歌い手部分は無視）から
 * 該当する歌い手リストを引く。"Verse 1" → "Verse" → "*" の順にフォールバックする。
 */
export function resolveVoices(vocalParts: unknown, sectionLabel: string | null): Voice[] {
  if (!vocalParts || typeof vocalParts !== "object") return [];
  const parts = vocalParts as Record<string, unknown>;
  const base = (sectionLabel ?? "").split(":")[0].trim();
  const candidates = [base, base.replace(/\s*\d+$/, ""), "*"];
  for (const key of candidates) {
    const tokens = key ? parts[key] : undefined;
    if (Array.isArray(tokens)) {
      return tokens
        .map((t) => (typeof t === "string" ? parseVoice(t) : null))
        .filter((v): v is Voice => v !== null)
        // 薄い線（ユニゾン）は画面で手動指定したものだけ。セクション指定の初期値は常に濃い線にする
        .map((v) => ({ ...v, role: "L" as const }));
    }
  }
  return [];
}

export function voiceToken(v: Voice): string {
  return `${v.member}:${v.role}${v.double ? ":2" : ""}`;
}

/**
 * 行の一部分だけに歌い手を割り当てるための単位。end は行内の文字位置（その位置の手前まで）。
 * 先頭からの区切りで、最後のパートは行末まで。分割していない行は1パートだけになる。
 */
export type VoicePart = { end: number; voices: Voice[] };

function parseTokens(tokens: unknown): Voice[] {
  if (!Array.isArray(tokens)) return [];
  return tokens
    .map((t) => (typeof t === "string" ? parseVoice(t) : null))
    .filter((v): v is Voice => v !== null);
}

/** 画面で編集した行単位の上書き（vocalOverrides）を、セクション指定より優先して引く */
export function resolveLineParts(
  vocalParts: unknown,
  vocalOverrides: unknown,
  lineIndex: number,
  sectionLabel: string | null,
  lineLength: number
): VoicePart[] {
  const songOrder = resolveSongOrder(vocalOverrides);
  const parts = resolveLinePartsRaw(vocalParts, vocalOverrides, lineIndex, sectionLabel, lineLength);
  // 曲全体の並び順の設定があれば全ての行に適用。なければ、セクション指定由来の初期値だけ既定の並びにする
  return songOrder
    ? applySongOrder(parts, songOrder)
    : isLineOverridden(vocalOverrides, lineIndex)
      ? parts
      : applySongOrder(parts, DEFAULT_ORDER);
}

/** 線の上下の既定の並び（上から）。個別の指定や曲ごとの設定があればそちらを優先する */
export const DEFAULT_ORDER: MemberKey[] = ["paul", "george", "john", "ringo"];

/** 曲全体の並び順の設定は、vocalOverrides の "_order" キーに保存する（行番号のキーとは別） */
export const SONG_ORDER_KEY = "_order";

export function resolveSongOrder(vocalOverrides: unknown): MemberKey[] | null {
  if (!vocalOverrides || typeof vocalOverrides !== "object") return null;
  const raw = (vocalOverrides as Record<string, unknown>)[SONG_ORDER_KEY];
  if (!Array.isArray(raw)) return null;
  const order = raw.filter((m): m is MemberKey => typeof m === "string" && m in MEMBERS);
  return order.length > 0 ? order : null;
}

/** 曲全体で「確認した資料」（URLとひとことメモ）の一覧は、vocalOverrides の "_sources" に保存する */
export const SOURCES_KEY = "_sources";

export type VocalSource = { url: string; note: string };

export function resolveSources(vocalOverrides: unknown): VocalSource[] {
  if (!vocalOverrides || typeof vocalOverrides !== "object") return [];
  const raw = (vocalOverrides as Record<string, unknown>)[SOURCES_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const { url, note } = (r ?? {}) as { url?: unknown; note?: unknown };
    return typeof url === "string" && /^https?:\/\//.test(url)
      ? [{ url, note: typeof note === "string" ? note : "" }]
      : [];
  });
}

function isLineOverridden(vocalOverrides: unknown, lineIndex: number): boolean {
  return (
    !!vocalOverrides &&
    typeof vocalOverrides === "object" &&
    (vocalOverrides as Record<string, unknown>)[String(lineIndex)] != null
  );
}

export function sortVoices(voices: Voice[], order: MemberKey[]): Voice[] {
  const rank = (m: MemberKey) => {
    const i = order.indexOf(m);
    return i < 0 ? order.length : i;
  };
  return [...voices].sort((a, b) => rank(a.member) - rank(b.member));
}

export function applySongOrder(parts: VoicePart[], order: MemberKey[]): VoicePart[] {
  return parts.map((p) => ({ ...p, voices: sortVoices(p.voices, order) }));
}

function resolveLinePartsRaw(
  vocalParts: unknown,
  vocalOverrides: unknown,
  lineIndex: number,
  sectionLabel: string | null,
  lineLength: number
): VoicePart[] {
  if (vocalOverrides && typeof vocalOverrides === "object") {
    const value = (vocalOverrides as Record<string, unknown>)[String(lineIndex)];
    // 旧形式: 行全体の歌い手の配列
    if (Array.isArray(value)) return [{ end: lineLength, voices: parseTokens(value) }];
    // 部分指定: { parts: [{ end, v: [...] }, ...] }
    const parts = (value as { parts?: unknown } | null | undefined)?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
      const result: VoicePart[] = [];
      let prev = 0;
      parts.forEach((p, i) => {
        const end =
          i === parts.length - 1 ? lineLength : Math.min(lineLength, Number((p as { end?: unknown })?.end));
        if (!(end > prev)) return;
        result.push({ end, voices: parseTokens((p as { v?: unknown })?.v) });
        prev = end;
      });
      if (result.length > 0) {
        result[result.length - 1].end = lineLength;
        return result;
      }
    }
  }
  return [{ end: lineLength, voices: resolveVoices(vocalParts, sectionLabel) }];
}

type Bar = { height: number; color: string; offset: number };

function layoutBars(voices: Voice[]): { bars: Bar[]; total: number } {
  // 上の線ほど音程が高い。ダブルトラックは同じ色の細い線を2本並べる
  const bars: Omit<Bar, "offset">[] = [];
  voices.forEach((v) => {
    // ユニゾンは薄く
    const color = v.role === "L" ? MEMBERS[v.member].color : MEMBERS[v.member].color + "99";
    const heights = v.double ? [2, 2] : [3];
    heights.forEach((height) => {
      bars.push({ height, color });
    });
  });

  // 下から積み上げた位置（下端からの距離）を求める
  const withOffset: Bar[] = [];
  let offset = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    withOffset.unshift({ ...bars[i], offset });
    // 同じ人の二重線は1px、それ以外は2px
    const sameVoiceAbove = i > 0 && ownerOf(voices, i - 1) === ownerOf(voices, i);
    offset += bars[i].height + (sameVoiceAbove ? 1 : 2);
  }
  return { bars: withOffset, total: offset - 2 + 3 }; // 最上段の隙間は不要、文字との間に3px
}

/** 下線ぶんの高さ（文字との間隔を含む）。voices が空なら 0 */
export function underlineTotal(voices: Voice[]): number {
  return voices.length === 0 ? 0 : layoutBars(voices).total;
}

/**
 * 歌っている人の下線を、文字そのものの背景として描くためのスタイル。
 * 行が折り返しても、折り返した各行の下にそれぞれ線が付く（box-decoration-break: clone）。
 * padTo は線のために空ける高さ。1行の中で部分ごとに線の本数が違うとき、
 * 全部分に同じ値（最大値）を渡すと、線の位置と行間が揃う。
 * 戻り値の lineHeight は、線を入れるぶん行間を広げるための値。
 */
export function voiceUnderlineStyle(
  voices: Voice[],
  padTo?: number
): {
  span: React.CSSProperties;
  lineHeight: string;
} | null {
  if (voices.length === 0 && !padTo) return null;

  const { bars, total } = voices.length > 0 ? layoutBars(voices) : { bars: [], total: 0 };
  const pad = Math.max(total, padTo ?? 0);
  const base = {
    paddingBottom: pad,
    WebkitBoxDecorationBreak: "clone",
    boxDecorationBreak: "clone",
  };

  return {
    span: (bars.length === 0
      ? base
      : {
          ...base,
          backgroundImage: bars.map((b) => `linear-gradient(${b.color},${b.color})`).join(","),
          backgroundRepeat: "no-repeat",
          backgroundSize: bars.map((b) => `100% ${b.height}px`).join(","),
          backgroundPosition: bars.map((b) => `0 calc(100% - ${b.offset}px)`).join(","),
        }) as React.CSSProperties,
    lineHeight: `calc(1.2em + ${2 * pad}px)`,
  };
}

// bars配列のi番目とj番目が同じ人の（ダブルトラックの）2本かどうか
/** i 本目の線が、voices の何番目の声のものか（ダブルトラックは1人で2本の線になる） */
function ownerOf(voices: Voice[], i: number): number {
  let index = 0;
  for (let vi = 0; vi < voices.length; vi++) {
    index += voices[vi].double ? 2 : 1;
    if (i < index) return vi;
  }
  return voices.length - 1;
}

/** 声の呼び名。濃い線は、1本だけならリード、2本以上ならハモリ。薄い線はユニゾン */
export function roleLabel(v: Voice, voiceCount: number): string {
  return v.role === "H" ? "ユニゾン" : voiceCount > 1 ? "ハモリ" : "リード";
}
