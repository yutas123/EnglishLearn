"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import YouTubeSeeker from "./YouTubeSeeker";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

// optional: カッコ内（コーラスなど）の語で、書かれていなかったもの。間違いにも採点対象にも数えない
type Status = "match" | "misheard" | "missing" | "spelling" | "form" | "gap" | "optional";

type Item = {
  ref: string;
  user: string | null;
  status: Status;
  extrasAfter: string[];
};

type GrammarLevel = "fixable" | "undecidable" | "nonstandard";

type GrammarNote = { word: string; level: GrammarLevel; note: string };

type ResultLine = {
  lineIndex: number;
  skipped: boolean;
  items: Item[];
  leadingExtras?: string[];
  explanation?: string;
  grammar?: GrammarNote[]; // 文法追加前に解説済みの行では undefined
};

type Result = {
  lines: ResultLine[];
  summary: {
    total: number;
    counts: Record<Exclude<Status, "optional">, number>;
    extra: number;
    gapMarks: number;
    accuracy: number;
  };
};

export type Attempt = {
  id: string;
  createdAt: string;
  text: string;
  scopeLines: number[] | null;
  accuracy: number;
  totalWords: number;
  gapCount: number;
  result: Result;
};

const STATUS_META: Record<
  Exclude<Status, "match" | "optional">,
  { label: string; word: string; hint: string }
> = {
  misheard: {
    label: "聞き違い",
    word: "bg-rose-100 text-rose-800",
    hint: "別の語として聞き取った",
  },
  missing: {
    label: "脱落",
    word: "bg-amber-100 text-amber-800",
    hint: "書き取れなかった（?? もなし）",
  },
  spelling: {
    label: "綴りミス",
    word: "bg-sky-100 text-sky-800",
    hint: "音は合っているが綴りが違う",
  },
  form: {
    label: "語形のずれ",
    word: "bg-violet-100 text-violet-800",
    hint: "語尾（-s / -ed / -ing など）が違う",
  },
  gap: {
    label: "?? 自己申告",
    word: "border border-dashed border-zinc-400 bg-zinc-50 text-zinc-700",
    hint: "自分で聞き取れないと印をつけた",
  },
};

const GRAMMAR_LEVELS: GrammarLevel[] = ["fixable", "undecidable", "nonstandard"];

const GRAMMAR_META: Record<GrammarLevel, { label: string; badge: string; hint: string }> = {
  fixable: {
    label: "文法で直せた",
    badge: "bg-emerald-100 text-emerald-800",
    hint: "標準的な文法から正解を推測できた",
  },
  undecidable: {
    label: "文法では決められない",
    badge: "bg-zinc-100 text-zinc-700",
    hint: "語彙や音の問題で、文法は手がかりにならない",
  },
  nonstandard: {
    label: "歌詞が崩している",
    badge: "bg-orange-100 text-orange-800",
    hint: "口語・省略・倒置など、歌詞があえて標準文法から外れている",
  },
};

const MISTAKE_STATUSES = ["misheard", "missing", "spelling", "form"] as const;

function percent(n: number) {
  return `${Math.round(n * 100)}%`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 指定した行だけでの正答率（採点対象外の行が含まれていれば null） */
function accuracyOnLines(result: Result, lineIndexes: number[]): number | null {
  let match = 0;
  let total = 0;
  for (const idx of lineIndexes) {
    const line = result.lines.find((l) => l.lineIndex === idx);
    if (!line || line.skipped) return null;
    for (const item of line.items) {
      if (item.status === "optional") continue;
      total += 1;
      if (item.status === "match") match += 1;
    }
  }
  return total > 0 ? match / total : null;
}

function lineHasMistake(line: ResultLine) {
  return !line.skipped && line.items.some((i) => i.status !== "match" && i.status !== "optional");
}

type RetrySegment =
  | { kind: "ok"; lineIndex: number; text: string }
  | { kind: "group"; key: number; lines: { lineIndex: number }[] }
  | { kind: "gap" };

/**
 * 再挑戦の表示用に、歌詞の流れを「文脈として見せる行」と「連続して間違えた行のまとまり（入力枠）」に分ける。
 * 文脈の行は、過去の答え合わせで一度でも表示された行をすべて集めたもの。再挑戦の結果には再挑戦した行しか
 * 含まれないため、元にした記録だけでは入力枠の前後の歌詞が足りなくなる。
 * 連続する間違い行は1つの入力枠にまとめる（歌い手の息継ぎと歌詞の改行は一致しないため、行ごとに分けると書きにくい）。
 */
function buildRetrySegments(base: Result, attempts: Attempt[]): RetrySegment[] {
  // attempts は新しい順。古い順にたどって、新しい記録の内容で上書きする
  const revealed = new Map<number, string>();
  for (const attempt of [...attempts].reverse()) {
    for (const line of attempt.result.lines) {
      if (!line.skipped) revealed.set(line.lineIndex, line.items.map((i) => i.ref).join(" "));
    }
  }

  const mistaken = new Set(base.lines.filter(lineHasMistake).map((l) => l.lineIndex));
  const segments: RetrySegment[] = [];
  let prevLineIndex: number | null = null;
  for (const lineIndex of [...revealed.keys()].sort((a, b) => a - b)) {
    // まだ一度も答え合わせで見えていない行が間にあれば、省略の印を入れる
    if (prevLineIndex !== null && lineIndex > prevLineIndex + 1) segments.push({ kind: "gap" });
    const last = segments[segments.length - 1];
    if (!mistaken.has(lineIndex)) {
      segments.push({ kind: "ok", lineIndex, text: revealed.get(lineIndex) ?? "" });
    } else if (last && last.kind === "group" && prevLineIndex === lineIndex - 1) {
      last.lines.push({ lineIndex });
    } else {
      segments.push({ kind: "group", key: lineIndex, lines: [{ lineIndex }] });
    }
    prevLineIndex = lineIndex;
  }
  return segments;
}

/** 文法判定の語数を段階別に数える（解説済みの行だけが対象） */
function countGrammar(result: Result) {
  const counts: Record<GrammarLevel, number> = { fixable: 0, undecidable: 0, nonstandard: 0 };
  let explainedLines = 0;
  for (const line of result.lines) {
    if (line.skipped || !line.grammar) continue;
    explainedLines += 1;
    for (const g of line.grammar) counts[g.level] += 1;
  }
  return { counts, explainedLines };
}

export default function DictationClient({
  trackId,
  initialAttempts,
  youtubeVideoId,
  initialNotes,
}: {
  trackId: string;
  initialAttempts: Attempt[];
  youtubeVideoId: string | null;
  initialNotes: Record<number, string>;
}) {
  const draftKey = `dictation-draft:${trackId}`;
  const [attempts, setAttempts] = useState<Attempt[]>(initialAttempts);
  const [selectedId, setSelectedId] = useState<string | null>(initialAttempts[0]?.id ?? null);
  const [text, setText] = useState("");
  // 再挑戦中の元になっている記録（null なら通常の入力）と、行ごとの入力内容
  const [retryBaseId, setRetryBaseId] = useState<string | null>(null);
  const [lineInputs, setLineInputs] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyMistakes, setOnlyMistakes] = useState(false);
  const [explaining, setExplaining] = useState<Set<string>>(new Set());
  const [explainErrors, setExplainErrors] = useState<Record<string, string>>({});
  // 行ごとの「聴き取れなかった理由」メモ（曲＋行番号に紐付くので、どの記録を見ても同じ行に出る）
  const [notes, setNotes] = useState<Record<number, string>>(initialNotes);
  // このページを開いてから原文を修正した行（過去の結果は当時の原文のままなので、修正後の文をここで見せる）
  const [fixedLines, setFixedLines] = useState<Record<number, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const retryPanelRef = useRef<HTMLDivElement>(null);

  // 書きかけの下書きはこのブラウザにだけ保持する（消えても困らない便宜機能）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) setText(saved);
    } catch {
      // localStorage が使えない環境では下書き保存なしで動作する
    }
  }, [draftKey]);

  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {
      // 同上
    }
  }, [draftKey, text]);

  const selected = attempts.find((a) => a.id === selectedId) ?? null;

  const retryBase = attempts.find((a) => a.id === retryBaseId) ?? null;
  const retrySegments = useMemo(
    () => (retryBase ? buildRetrySegments(retryBase.result, attempts) : []),
    [retryBase, attempts]
  );
  const retryFilledCount = Object.values(lineInputs).filter((v) => v.trim()).length;

  function insertGapMark() {
    const el = textareaRef.current;
    const pos = el ? el.selectionStart : text.length;
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const insert = `${needsSpace ? " " : ""}?? `;
    setText(before + insert + after);
    requestAnimationFrame(() => {
      el?.focus();
      const next = pos + insert.length;
      el?.setSelectionRange(next, next);
    });
  }

  async function handleSubmit() {
    const isRetry = retryBase !== null;
    if (!BACKEND_URL || submitting) return;
    if (isRetry ? retryFilledCount === 0 : !text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = isRetry
        ? {
            trackId,
            groups: retrySegments.flatMap((seg) =>
              seg.kind === "group" && (lineInputs[seg.key] ?? "").trim()
                ? [{ lineIndexes: seg.lines.map((l) => l.lineIndex), text: lineInputs[seg.key] }]
                : []
            ),
          }
        : { trackId, text };
      const res = await fetch(`${BACKEND_URL}/api/dictation/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "答え合わせに失敗しました");
      const attempt: Attempt = { ...data, scopeLines: data.scopeLines ?? null };
      setAttempts((prev) => [attempt, ...prev]);
      setSelectedId(attempt.id);
      if (isRetry) {
        setRetryBaseId(null);
        setLineInputs({});
      } else {
        setText("");
      }
      setOnlyMistakes(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveNote(lineIndex: number, note: string) {
    const trimmed = note.trim();
    if (trimmed === (notes[lineIndex] ?? "") || !BACKEND_URL) return;
    const previous = notes[lineIndex];
    setNotes((prev) => {
      const next = { ...prev };
      if (trimmed) next[lineIndex] = trimmed;
      else delete next[lineIndex];
      return next;
    });
    try {
      const res = await fetch(`${BACKEND_URL}/api/tracks/${trackId}/notes/${lineIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // 保存に失敗したら元に戻す
      setNotes((prev) => {
        const next = { ...prev };
        if (previous) next[lineIndex] = previous;
        else delete next[lineIndex];
        return next;
      });
      setError("メモを保存できませんでした");
    }
  }

  async function fixLine(lineIndex: number, original: string) {
    if (!BACKEND_URL) throw new Error("設定エラー");
    const res = await fetch(`${BACKEND_URL}/api/tracks/${trackId}/lines/${lineIndex}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "原文を修正できませんでした");
    setFixedLines((prev) => ({ ...prev, [lineIndex]: data.original }));
  }

  function startRetry(attempt: Attempt) {
    if (!attempt.result.lines.some(lineHasMistake)) return;
    setRetryBaseId(attempt.id);
    setLineInputs({});
    setError(null);
    requestAnimationFrame(() =>
      retryPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }

  async function handleExplain(attempt: Attempt, lineIndex: number) {
    const key = `${attempt.id}:${lineIndex}`;
    if (!BACKEND_URL || explaining.has(key)) return;
    setExplaining((prev) => new Set(prev).add(key));
    setExplainErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const res = await fetch(`${BACKEND_URL}/api/dictation/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: attempt.id, lineIndex }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "解説の取得に失敗しました");
      setAttempts((prev) =>
        prev.map((a) =>
          a.id !== attempt.id
            ? a
            : {
                ...a,
                result: {
                  ...a.result,
                  lines: a.result.lines.map((l) =>
                    l.lineIndex === lineIndex
                      ? { ...l, explanation: data.explanation, grammar: data.grammar ?? [] }
                      : l
                  ),
                },
              }
        )
      );
    } catch (err) {
      setExplainErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "エラーが発生しました",
      }));
    } finally {
      setExplaining((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function explainAll(attempt: Attempt) {
    const targets = attempt.result.lines
      .filter((l) => lineHasMistake(l) && !l.grammar)
      .map((l) => l.lineIndex);
    for (const lineIndex of targets) {
      await handleExplain(attempt, lineIndex);
    }
  }

  // 答え合わせの結果を見ている間は、入力欄を画面下に固定して、結果を見ながら練習のタイピングができるようにする
  const dockInput = selected !== null && !retryBase;

  return (
    <div className={`flex flex-col gap-8 ${dockInput ? "pb-64" : ""}`}>
      {/* YouTube再生（Ctrl+矢印キーで入力欄から5秒戻し・送り） */}
      <YouTubeSeeker trackId={trackId} initialVideoId={youtubeVideoId} />

      {/* 入力 */}
      {retryBase ? (
        <section ref={retryPanelRef} className="flex flex-col gap-3">
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">
                再挑戦：これまでの答え合わせで見えた歌詞の流れです。枠で囲んだ範囲を、前後の行を手がかりに
                聴き直して書いてください。連続して間違えた行は1つの枠にまとめています。書かなかった枠は採点されません。
              </p>
              <button
                onClick={() => {
                  setRetryBaseId(null);
                  setLineInputs({});
                }}
                className="shrink-0 underline decoration-dotted"
              >
                やめる
              </button>
            </div>
          </div>

          <div className="flex flex-col">
            {retrySegments.map((seg, i) => {
              if (seg.kind === "gap") {
                return (
                  <div key={`gap-${i}`} className="py-0.5 pl-9 text-xs text-zinc-300">
                    ⋯
                  </div>
                );
              }
              if (seg.kind === "ok") {
                return (
                  <div key={seg.lineIndex} className="flex gap-2 py-1.5">
                    <span className="w-7 shrink-0 pt-0.5 text-right text-[10px] text-zinc-400">
                      {seg.lineIndex + 1}
                    </span>
                    <p className="min-w-0 break-words text-sm leading-relaxed text-zinc-500">
                      {seg.text}
                    </p>
                  </div>
                );
              }
              const first = seg.lines[0].lineIndex + 1;
              const last = seg.lines[seg.lines.length - 1].lineIndex + 1;
              const rangeLabel = seg.lines.length === 1 ? `${first}行目` : `${first}〜${last}行目`;
              return (
                <div
                  key={seg.key}
                  className="my-1.5 flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50/60 p-2"
                >
                  <p className="text-xs font-medium text-amber-800">
                    ✍️ {rangeLabel}
                    {seg.lines.length > 1 && `（${seg.lines.length}行ぶんを続けて書く）`}
                  </p>
                  <textarea
                    value={lineInputs[seg.key] ?? ""}
                    onChange={(e) =>
                      setLineInputs((prev) => ({ ...prev, [seg.key]: e.target.value }))
                    }
                    rows={Math.max(2, seg.lines.length + 1)}
                    placeholder={
                      seg.lines.length > 1
                        ? `この${seg.lines.length}行ぶんを続けて書く（行の区切りは気にしなくてOK・聞き取れない所は ??）`
                        : "この行を聴いて書く（聞き取れない所は ??）"
                    }
                    className="w-full rounded-lg border border-amber-300 bg-white p-2 text-base leading-relaxed focus:border-amber-500 focus:outline-none"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting || retryFilledCount === 0}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {submitting ? "採点中..." : `答え合わせ（${retryFilledCount}箇所）`}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>
      ) : (
        <section
          className={
            dockInput
              ? "fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur"
              : "flex flex-col gap-2"
          }
        >
         <div className={dockInput ? "mx-auto flex max-w-3xl flex-col gap-2 px-4 py-2" : "contents"}>
          {!dockInput && (
            <p className="rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
              Spotifyで曲を聴きながら、聞こえた英語を書いてください。行の区切りは歌詞と合っていなくて構いません。
              聞き取れない箇所は <code className="rounded bg-zinc-200 px-1">??</code>{" "}
              と書いておくと、「自分で気づいていた聞き取れなさ」として記録されます。
            </p>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={dockInput ? 5 : 10}
            placeholder="聞こえた英語をここに書く…"
            className="w-full rounded-lg border border-zinc-300 p-3 text-base leading-relaxed focus:border-zinc-500 focus:outline-none"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting || !text.trim()}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {submitting ? "採点中..." : "答え合わせ"}
            </button>
            <button
              onClick={insertGapMark}
              className="rounded-full border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
              title="カーソル位置に「??」を挿入"
            >
              ?? を挿入
            </button>
            {text && (
              <button
                onClick={() => setText("")}
                className="text-xs text-zinc-500 underline decoration-dotted"
              >
                クリア
              </button>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
         </div>
        </section>
      )}

      {/* 結果 */}
      {selected && (
        <ResultView
          attempt={selected}
          attempts={attempts}
          notes={notes}
          onSaveNote={saveNote}
          fixedLines={fixedLines}
          onFixLine={fixLine}
          onlyMistakes={onlyMistakes}
          setOnlyMistakes={setOnlyMistakes}
          explaining={explaining}
          explainErrors={explainErrors}
          onExplain={(lineIndex) => handleExplain(selected, lineIndex)}
          onExplainAll={() => explainAll(selected)}
          onRetry={() => startRetry(selected)}
        />
      )}

      {/* 履歴 */}
      {attempts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-700">これまでの記録</h2>
          <ul className="flex flex-col divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {attempts.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setSelectedId(a.id)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50 ${
                    a.id === selectedId ? "bg-zinc-50 font-medium" : ""
                  }`}
                >
                  <span className="text-zinc-600">
                    {formatDate(a.createdAt)}
                    {a.scopeLines && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        {a.scopeLines.length}行のみ
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-zinc-800">
                    {percent(a.accuracy)}
                    <span className="ml-2 text-xs text-zinc-500">?? {a.gapCount}</span>
                    {countGrammar(a.result).explainedLines > 0 && (
                      <span
                        className="ml-2 text-xs text-emerald-700"
                        title="文法で直せた語数（解説した行のみ）"
                      >
                        📐 {countGrammar(a.result).counts.fixable}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ResultView({
  attempt,
  attempts,
  notes,
  onSaveNote,
  fixedLines,
  onFixLine,
  onlyMistakes,
  setOnlyMistakes,
  explaining,
  explainErrors,
  onExplain,
  onExplainAll,
  onRetry,
}: {
  attempt: Attempt;
  attempts: Attempt[];
  notes: Record<number, string>;
  onSaveNote: (lineIndex: number, note: string) => void;
  fixedLines: Record<number, string>;
  onFixLine: (lineIndex: number, original: string) => Promise<void>;
  onlyMistakes: boolean;
  setOnlyMistakes: (v: boolean) => void;
  explaining: Set<string>;
  explainErrors: Record<string, string>;
  onExplain: (lineIndex: number) => void;
  onExplainAll: () => void;
  onRetry: () => void;
}) {
  const { result } = attempt;
  const { summary } = result;
  const scoredLines = result.lines.filter((l) => !l.skipped);
  const skippedCount = result.lines.length - scoredLines.length;
  const mistakeLineCount = scoredLines.filter(lineHasMistake).length;
  const unnoticed = MISTAKE_STATUSES.reduce((sum, s) => sum + summary.counts[s], 0);
  const grammarStats = countGrammar(result);
  const unexplainedLines = scoredLines.filter((l) => lineHasMistake(l) && !l.grammar).length;
  const anyExplaining = scoredLines.some((l) => explaining.has(`${attempt.id}:${l.lineIndex}`));

  // 前回との比較：自分より古い記録のうち、同じ範囲を採点しているもの
  const delta = useMemo(() => {
    const older = attempts.filter((a) => a.createdAt < attempt.createdAt);
    if (attempt.scopeLines) {
      for (const prev of older) {
        const prevAcc = accuracyOnLines(prev.result, attempt.scopeLines);
        if (prevAcc !== null) {
          return { label: "同じ行の前回", prev: prevAcc, now: attempt.accuracy, prevGap: null };
        }
      }
      return null;
    }
    const prev = older.find((a) => !a.scopeLines);
    return prev
      ? { label: "前回", prev: prev.accuracy, now: attempt.accuracy, prevGap: prev.gapCount }
      : null;
  }, [attempt, attempts]);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-700">
          答え合わせ（{formatDate(attempt.createdAt)}
          {attempt.scopeLines ? ` ・ ${attempt.scopeLines.length}行のみ` : ""}）
        </h2>
        <p className="mt-1 text-2xl font-bold">
          {percent(summary.accuracy)}
          <span className="ml-2 text-sm font-normal text-zinc-500">
            {summary.counts.match} / {summary.total} 語 一致
          </span>
        </p>
        {delta && (
          <p className="text-xs text-zinc-500">
            {delta.label} {percent(delta.prev)} →{" "}
            <span
              className={
                delta.now > delta.prev
                  ? "font-medium text-emerald-600"
                  : delta.now < delta.prev
                  ? "font-medium text-rose-600"
                  : ""
              }
            >
              {percent(delta.now)}
            </span>
            {delta.prevGap !== null && ` ・ ?? の数 ${delta.prevGap} → ${attempt.gapCount}`}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {mistakeLineCount > 0 && (
          <button
            onClick={onRetry}
            className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            🔁 間違えた {mistakeLineCount} 行だけ再挑戦
          </button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={onlyMistakes}
            onChange={(e) => setOnlyMistakes(e.target.checked)}
          />
          間違えた行だけ表示
        </label>
      </div>

      <details className="text-xs text-zinc-500">
        <summary className="w-fit cursor-pointer select-none">内訳・AI解説 ▾</summary>
        <div className="mt-2 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((s) => (
          <span
            key={s}
            title={STATUS_META[s].hint}
            className={`rounded px-2 py-1 ${STATUS_META[s].word}`}
          >
            {STATUS_META[s].label} {summary.counts[s]}
          </span>
        ))}
        {summary.extra > 0 && (
          <span
            title="歌詞にない語を書いた"
            className="rounded border border-dashed border-zinc-300 px-2 py-1 text-zinc-500"
          >
            余分 {summary.extra}
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-zinc-500">
        ?? にした語は {summary.counts.gap}語。気づかないまま間違えていた語は{" "}
        <span className="font-medium text-zinc-700">{unnoticed}語</span>
        （聞き違い・脱落・綴り・語形の合計）。後者が多いほど、「聞こえたつもり」のズレが大きいことを示します。
      </p>

      {grammarStats.explainedLines > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2 text-xs">
            {GRAMMAR_LEVELS.map((lv) => (
              <span
                key={lv}
                title={GRAMMAR_META[lv].hint}
                className={`rounded px-2 py-1 ${GRAMMAR_META[lv].badge}`}
              >
                {GRAMMAR_META[lv].label} {grammarStats.counts[lv]}
              </span>
            ))}
          </div>
          <p className="text-xs text-zinc-400">
            文法面の集計は、解説した {grammarStats.explainedLines} 行の間違い語が対象です。
          </p>
        </div>
      )}

          {unexplainedLines > 0 && (
            <button
              onClick={onExplainAll}
              disabled={anyExplaining}
              className="w-fit rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {anyExplaining ? "解説を生成中..." : `🗣️ 残り ${unexplainedLines} 行をまとめて解説`}
            </button>
          )}
        </div>
      </details>

      {/* 行ごとの判定 */}
      <div className="flex flex-col divide-y divide-zinc-100">
        {scoredLines
          .filter((line) => !onlyMistakes || lineHasMistake(line))
          .map((line) => {
            const key = `${attempt.id}:${line.lineIndex}`;
            const hasMistake = lineHasMistake(line);
            return (
              <div key={line.lineIndex} className="flex flex-col gap-1.5 py-3">
                <div className="flex gap-2">
                  <span className="w-7 shrink-0 pt-0.5 text-right text-[10px] text-zinc-400">
                    {line.lineIndex + 1}
                  </span>
                  <div className="flex min-w-0 flex-wrap items-start gap-x-1.5 gap-y-1.5">
                    {line.leadingExtras?.map((w, i) => (
                      <ExtraChip key={`lead-${i}`} word={w} />
                    ))}
                    {line.items.map((item, i) => (
                      <span key={i} className="inline-flex items-start gap-1.5">
                        <span className="inline-flex flex-col items-start leading-tight">
                          <span
                            title={item.status === "optional" ? "カッコ内（任意）：書かなくても減点されません" : undefined}
                            className={`rounded px-1 text-sm ${
                              item.status === "match"
                                ? ""
                                : item.status === "optional"
                                ? "text-zinc-400"
                                : STATUS_META[item.status].word
                            }`}
                          >
                            {item.ref}
                          </span>
                          {item.status !== "match" && item.status !== "optional" && (
                            <span className="px-1 text-sm text-zinc-500">
                              {item.user ?? "—"}
                            </span>
                          )}
                        </span>
                        {item.extrasAfter.map((w, k) => (
                          <ExtraChip key={k} word={w} />
                        ))}
                      </span>
                    ))}
                  </div>
                </div>

                {hasMistake && (
                  <div className="ml-9 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <NoteEditor
                        note={notes[line.lineIndex] ?? ""}
                        onSave={(text) => onSaveNote(line.lineIndex, text)}
                      />
                      <LineFixer
                        initial={fixedLines[line.lineIndex] ?? line.items.map((it) => it.ref).join(" ")}
                        onSave={(text) => onFixLine(line.lineIndex, text)}
                      />
                    </div>
                    {fixedLines[line.lineIndex] && (
                      <p className="break-words text-xs text-emerald-700">
                        原文を修正: {fixedLines[line.lineIndex]}
                      </p>
                    )}
                    <details className="text-xs">
                      <summary className="w-fit cursor-pointer select-none text-zinc-400 hover:text-zinc-600">
                        AI解説 ▾
                      </summary>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                    {line.explanation && (
                      <p className="break-words rounded bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-600">
                        🗣️ {line.explanation}
                      </p>
                    )}
                    {line.grammar && line.grammar.length > 0 && (
                      <ul className="flex flex-col gap-1 rounded bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-600">
                        {line.grammar.map((g, i) => (
                          <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                            <span>📐</span>
                            <span className="font-medium text-zinc-800">{g.word}</span>
                            <span
                              title={GRAMMAR_META[g.level].hint}
                              className={`rounded px-1.5 py-0.5 text-[10px] ${GRAMMAR_META[g.level].badge}`}
                            >
                              {GRAMMAR_META[g.level].label}
                            </span>
                            <span className="break-words">{g.note}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(!line.explanation || !line.grammar) && (
                      <button
                        onClick={() => onExplain(line.lineIndex)}
                        disabled={explaining.has(key)}
                        className="w-fit text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-700 disabled:opacity-50"
                      >
                        {explaining.has(key)
                          ? "解説を生成中..."
                          : line.explanation
                          ? "📐 文法も解説"
                          : "🗣️ 原因を解説"}
                      </button>
                    )}
                    {explainErrors[key] && (
                      <p className="text-xs text-red-600">{explainErrors[key]}</p>
                    )}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {skippedCount > 0 && (
        <p className="text-xs text-zinc-400">
          書かれていない範囲の {skippedCount} 行は採点対象外にしています。
        </p>
      )}
    </section>
  );
}

/** 行ごとの一言メモ。メモがあれば薄い黄色で常時表示し、押すと編集、フォーカスを外すと保存する */
function NoteEditor({ note, onSave }: { note: string; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(note);
            setEditing(false);
          }
        }}
        maxLength={500}
        placeholder="なぜ聴き取れなかった？（例: 弱形で消えてた）"
        className="w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-base focus:outline-none sm:text-xs"
      />
    );
  }
  return (
    <button
      onClick={() => {
        setDraft(note);
        setEditing(true);
      }}
      className={
        note
          ? "w-fit max-w-full break-words rounded bg-amber-50 px-2 py-1 text-left text-xs text-amber-900"
          : "w-fit text-xs text-zinc-400 hover:text-zinc-600"
      }
    >
      {note ? `✎ ${note}` : "✎ メモ"}
    </button>
  );
}

/** 歌詞原文の修正（めったに使わないので、目立たない「⋯」から開く）。次回以降の採点から新しい原文が使われる */
function LineFixer({ initial, onSave }: { initial: string; onSave: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => {
          setDraft(initial);
          setError(null);
          setOpen(true);
        }}
        title="この行の歌詞（原文）を修正"
        className="text-xs text-zinc-300 hover:text-zinc-500"
      >
        ⋯
      </button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-1 rounded border border-zinc-200 p-2">
      <p className="text-[11px] text-zinc-500">
        この行の歌詞（原文）を修正します。過去の結果は変わらず、次回以降の採点から反映されます。
      </p>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={500}
        className="w-full rounded border border-zinc-300 px-2 py-1 text-base focus:outline-none sm:text-sm"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <div className="flex items-center gap-3 text-xs">
        <button
          disabled={saving || !draft.trim()}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await onSave(draft);
              setOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "エラーが発生しました");
            } finally {
              setSaving(false);
            }
          }}
          className="rounded-full bg-zinc-900 px-3 py-1 text-white disabled:opacity-40"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        <button onClick={() => setOpen(false)} className="text-zinc-500 underline decoration-dotted">
          キャンセル
        </button>
        {error && <span className="text-red-600">{error}</span>}
      </div>
    </div>
  );
}

function ExtraChip({ word }: { word: string }) {
  return (
    <span
      title="歌詞にない語"
      className="rounded border border-dashed border-zinc-300 px-1 text-xs text-zinc-400"
    >
      +{word}
    </span>
  );
}
