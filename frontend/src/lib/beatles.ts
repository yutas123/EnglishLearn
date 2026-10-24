// ビートルズ曲の「誰が歌っているか」表示用ヘルパー。
// Track.vocalParts は { "Verse 1": ["john:L", "paul:B"], "*": [...] } 形式（配列順＝音程の高い順）。

export const MEMBERS = {
  john: { name: "John", color: "#3b82f6" },
  paul: { name: "Paul", color: "#ef4444" },
  george: { name: "George", color: "#22c55e" },
  ringo: { name: "Ringo", color: "#f59e0b" },
} as const;

export type MemberKey = keyof typeof MEMBERS;

// 'john:L' / 'paul:H' / 'john:L:2'（末尾の2=ダブルトラック）。L=リード、H=ハモリ（リードと同じ歌詞を重ねる声）。コーラス/掛け合いは線を引かないのでデータに含めない
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
        .filter((v): v is Voice => v !== null);
    }
  }
  return [];
}

export function voiceToken(v: Voice): string {
  return `${v.member}:${v.role}${v.double ? ":2" : ""}`;
}

/** 画面で編集した行単位の上書き（vocalOverrides）を、セクション指定より優先して引く */
export function resolveLineVoices(
  vocalParts: unknown,
  vocalOverrides: unknown,
  lineIndex: number,
  sectionLabel: string | null
): Voice[] {
  if (vocalOverrides && typeof vocalOverrides === "object") {
    const tokens = (vocalOverrides as Record<string, unknown>)[String(lineIndex)];
    if (Array.isArray(tokens)) {
      return tokens
        .map((t) => (typeof t === "string" ? parseVoice(t) : null))
        .filter((v): v is Voice => v !== null);
    }
  }
  return resolveVoices(vocalParts, sectionLabel);
}

type Bar = { height: number; color: string; offset: number };

/**
 * 歌っている人の下線を、文字そのものの背景として描くためのスタイル。
 * 行が折り返しても、折り返した各行の下にそれぞれ線が付く（box-decoration-break: clone）。
 * 戻り値の lineHeight は、線を入れるぶん行間を広げるための値。
 */
export function voiceUnderlineStyle(voices: Voice[]): {
  span: React.CSSProperties;
  lineHeight: string;
} | null {
  if (voices.length === 0) return null;

  // 上の線ほど音程が高い。ダブルトラックは同じ色の細い線を2本並べる
  const bars: Omit<Bar, "offset">[] = [];
  voices.forEach((v, i) => {
    // ハモリはリードより少し薄く
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
    const sameVoiceAbove = i > 0 && isSameVoice(voices, i, i - 1);
    offset += bars[i].height + (sameVoiceAbove ? 1 : 2);
  }
  const total = offset - 2 + 3; // 最上段の隙間は不要、文字との間に3px

  return {
    span: {
      backgroundImage: withOffset.map((b) => `linear-gradient(${b.color},${b.color})`).join(","),
      backgroundRepeat: "no-repeat",
      backgroundSize: withOffset.map((b) => `100% ${b.height}px`).join(","),
      backgroundPosition: withOffset.map((b) => `0 calc(100% - ${b.offset}px)`).join(","),
      paddingBottom: total,
      WebkitBoxDecorationBreak: "clone",
      boxDecorationBreak: "clone",
    } as React.CSSProperties,
    lineHeight: `calc(1.2em + ${2 * total}px)`,
  };
}

// bars配列のi番目とj番目が同じ人の（ダブルトラックの）2本かどうか
function isSameVoice(voices: Voice[], i: number, j: number): boolean {
  let index = 0;
  const owner: number[] = [];
  voices.forEach((v, vi) => {
    for (let k = 0; k < (v.double ? 2 : 1); k++) owner[index++] = vi;
  });
  return owner[i] === owner[j];
}
