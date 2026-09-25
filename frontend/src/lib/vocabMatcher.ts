export type MatchSpan = { start: number; end: number };

export type VocabTermInput = {
  id: string;
  term: string;
  isPhrase: boolean;
  meaning: string;
  partOfSpeech: string | null;
  cefr: string | null;
  explanation: string | null;
  sourceTrackId: string;
};

export type KnownSpan = MatchSpan & {
  vocabEntryId: string;
  term: string;
  meaning: string;
  partOfSpeech: string | null;
  cefr: string | null;
  explanation: string | null;
  sourceTrackId: string;
};

export type VocabMatcher = {
  wordStems: Map<string, VocabTermInput>;
  phraseEntries: VocabTermInput[];
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
 * 単語=Map参照、熟語=1本の正規表現なので、行数×語彙数のループにはならない。
 */
export function buildMatcher(entries: VocabTermInput[]): VocabMatcher {
  const wordStems = new Map<string, VocabTermInput>();
  const phraseEntries: VocabTermInput[] = [];

  for (const entry of entries) {
    if (entry.isPhrase) {
      phraseEntries.push(entry);
    } else {
      wordStems.set(crudeStem(entry.term), entry);
    }
  }

  // 長いフレーズを先にマッチさせる（短い部分文字列が先に食われるのを防ぐ）
  phraseEntries.sort((a, b) => b.term.length - a.term.length);

  const phraseRegex =
    phraseEntries.length > 0
      ? new RegExp(phraseEntries.map((e) => `(${escapeRegExp(e.term.toLowerCase())})`).join("|"), "gi")
      : null;

  return { wordStems, phraseEntries, phraseRegex };
}

/**
 * 1行のテキストに対して、既知語彙にマッチする範囲（文字オフセット）とその語彙情報を返す。
 * フレーズ一致を優先し、その範囲と重ならない単語だけ単語一致を追加する。
 */
export function findKnownSpans(text: string, matcher: VocabMatcher): KnownSpan[] {
  const spans: KnownSpan[] = [];

  if (matcher.phraseRegex) {
    matcher.phraseRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.phraseRegex.exec(text)) !== null) {
      const groupIndex = match.slice(1).findIndex((g) => g !== undefined);
      const entry = matcher.phraseEntries[groupIndex];
      if (entry) {
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          vocabEntryId: entry.id,
          term: entry.term,
          meaning: entry.meaning,
          partOfSpeech: entry.partOfSpeech,
          cefr: entry.cefr,
          explanation: entry.explanation,
          sourceTrackId: entry.sourceTrackId,
        });
      }
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
      const entry = matcher.wordStems.get(crudeStem(match[0]));
      if (entry) {
        spans.push({
          start,
          end,
          vocabEntryId: entry.id,
          term: entry.term,
          meaning: entry.meaning,
          partOfSpeech: entry.partOfSpeech,
          cefr: entry.cefr,
          explanation: entry.explanation,
          sourceTrackId: entry.sourceTrackId,
        });
      }
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}
