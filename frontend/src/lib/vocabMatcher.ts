export type MatchSpan = { start: number; end: number };

type VocabTermInput = { term: string; isPhrase: boolean };

export type VocabMatcher = {
  wordStems: Set<string>;
  phraseRegex: RegExp | null;
};

/**
 * 簡易ステマー（末尾の -ing/-ed/-s を削るだけの荒い活用形吸収）。
 * 真の見出し語化ではなく、歌詞中の活用形と登録済みlemmaを緩く一致させるためのMVP簡略化。
 */
function crudeStem(word: string): string {
  let s = word.toLowerCase();
  if (s.endsWith("'s")) s = s.slice(0, -2);
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 語彙リストから一度だけマッチャーを構築する。語彙が増えても検索は
 * 単語=Set参照、熟語=1本の正規表現なので、行数×語彙数のループにはならない。
 */
export function buildMatcher(entries: VocabTermInput[]): VocabMatcher {
  const wordStems = new Set<string>();
  const phraseTerms: string[] = [];

  for (const entry of entries) {
    if (entry.isPhrase) {
      phraseTerms.push(entry.term.toLowerCase());
    } else {
      wordStems.add(crudeStem(entry.term));
    }
  }

  // 長いフレーズを先にマッチさせる（短い部分文字列が先に食われるのを防ぐ）
  phraseTerms.sort((a, b) => b.length - a.length);

  const phraseRegex =
    phraseTerms.length > 0
      ? new RegExp(phraseTerms.map(escapeRegExp).join("|"), "gi")
      : null;

  return { wordStems, phraseRegex };
}

/**
 * 1行のテキストに対して、既知語彙にマッチする範囲（文字オフセット）を返す。
 * フレーズ一致を優先し、その範囲と重ならない単語だけ単語一致を追加する。
 */
export function findKnownSpans(text: string, matcher: VocabMatcher): MatchSpan[] {
  const spans: MatchSpan[] = [];

  if (matcher.phraseRegex) {
    matcher.phraseRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.phraseRegex.exec(text)) !== null) {
      spans.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) matcher.phraseRegex.lastIndex++;
    }
  }

  if (matcher.wordStems.size > 0) {
    const wordPattern = /[A-Za-z']+/g;
    let match: RegExpExecArray | null;
    while ((match = wordPattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const overlapsPhrase = spans.some((s) => start < s.end && end > s.start);
      if (overlapsPhrase) continue;
      if (matcher.wordStems.has(crudeStem(match[0]))) {
        spans.push({ start, end });
      }
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}
