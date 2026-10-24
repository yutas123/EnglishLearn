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
