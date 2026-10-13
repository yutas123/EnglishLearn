"use client";

import { useState } from "react";
import LineGrammarPanel, { type ChatMessage, type Grammar } from "./LineGrammarPanel";

type Line = {
  id: string;
  lineIndex: number;
  original: string;
  translation: string;
  sentenceStart: number | null;
  sectionLabel: string | null;
  grammar: Grammar | null;
  chatMessages: ChatMessage[];
};

function TextIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

function PuzzleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.4 12.6V8.5a1 1 0 0 0-1-1h-3.9a2.5 2.5 0 1 0-5 0H5.6a1 1 0 0 0-1 1v3.9a2.5 2.5 0 1 1 0 5v2.1a1 1 0 0 0 1 1h12.8a1 1 0 0 0 1-1v-3.9a2.5 2.5 0 1 1 0-5Z" />
    </svg>
  );
}

function IconButton({
  active,
  done = false,
  label,
  onClick,
  children,
}: {
  active: boolean;
  done?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
        active
          ? "bg-sky-100 text-sky-700"
          : done
            ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
            : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
      }`}
    >
      {children}
    </button>
  );
}

export default function ListeningLines({
  trackId,
  lines,
}: {
  trackId: string;
  lines: Line[];
}) {
  const [shownTranslations, setShownTranslations] = useState<Set<number>>(new Set());
  const [openGrammar, setOpenGrammar] = useState<Set<number>>(new Set());
  // 解説（またはチャット）が一度でもできた文（文の先頭行のlineIndex）。閉じていても色で分かるようにする
  const [generatedLines, setGeneratedLines] = useState<Set<number>>(
    () => new Set(lines.filter((l) => l.grammar || l.chatMessages.length > 0).map((l) => l.lineIndex))
  );
  // 文の先頭行（文法解説・チャットのデータはここに載っている）
  const unitStartLine = new Map(lines.map((l) => [l.sentenceStart ?? l.lineIndex, l]));

  function markGenerated(lineIndex: number, generated: boolean) {
    setGeneratedLines((prev) => {
      if (prev.has(lineIndex) === generated) return prev;
      const next = new Set(prev);
      if (generated) next.add(lineIndex);
      else next.delete(lineIndex);
      return next;
    });
  }

  function toggle(setter: typeof setShownTranslations, lineIndex: number) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(lineIndex)) next.delete(lineIndex);
      else next.add(lineIndex);
      return next;
    });
  }

  return (
    <div className="flex flex-col">
      {lines.map((line, index) => {
        const prevLabel = index > 0 ? lines[index - 1].sectionLabel : null;
        const sectionLabel =
          line.sectionLabel && line.sectionLabel !== prevLabel ? line.sectionLabel : null;
        const isNewSection = Boolean(sectionLabel) && index > 0;
        // 複数行にまたがる文は、訳を最終行の下に1つだけ出す（sentenceStartがnullの古いデータは1行1文）
        const sentenceKey = line.sentenceStart ?? line.lineIndex;
        const prevLine = index > 0 ? lines[index - 1] : null;
        const nextLine = index < lines.length - 1 ? lines[index + 1] : null;
        const isSentenceEnd = !nextLine || (nextLine.sentenceStart ?? nextLine.lineIndex) !== sentenceKey;
        const isMultiLineSentence =
          (prevLine !== null && (prevLine.sentenceStart ?? prevLine.lineIndex) === sentenceKey) ||
          !isSentenceEnd;
        const isSentenceStart =
          !prevLine || (prevLine.sentenceStart ?? prevLine.lineIndex) !== sentenceKey;
        // 同じ文の行どうしは行間を詰める
        const paddingY = isMultiLineSentence
          ? `${isSentenceStart ? "pt-2.5" : "pt-0.5"} ${isSentenceEnd ? "pb-2.5" : "pb-0.5"}`
          : "py-2.5";
        const showTranslation = shownTranslations.has(sentenceKey);
        const showGrammar = openGrammar.has(sentenceKey);
        const unitHead = unitStartLine.get(sentenceKey) ?? line;

        return (
          <div
            key={line.id}
            className={`flex flex-col gap-1 ${paddingY} ${
              isNewSection ? "border-t border-zinc-200 pt-4" : ""
            } ${isMultiLineSentence ? "border-l-2 border-l-zinc-200 pl-3" : ""} ${
            isMultiLineSentence && index > 0 && isSentenceStart ? "mt-2" : ""
          }`}
          >
            {sectionLabel && (
              <div
                className="mb-1 text-xs font-semibold tracking-wide"
                style={{ color: "rgb(117 117 125)" }}
              >
                [{sectionLabel}]
              </div>
            )}

            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words font-medium leading-relaxed">{line.original}</p>
              <div className="flex shrink-0 items-center gap-0.5">
                {/* 複数行にまたがる文の対訳は同じ内容なので、先頭行のボタンだけにする */}
                {isSentenceStart ? (
                  <IconButton
                    active={showTranslation}
                    label={showTranslation ? "対訳を閉じる" : "対訳を表示"}
                    onClick={() => toggle(setShownTranslations, sentenceKey)}
                  >
                    <TextIcon />
                  </IconButton>
                ) : (
                  <span className="h-7 w-7" aria-hidden />
                )}
                {isSentenceStart ? (
                  <IconButton
                    active={showGrammar}
                    done={generatedLines.has(sentenceKey)}
                    label={
                      showGrammar
                        ? "解説を閉じる"
                        : generatedLines.has(sentenceKey)
                          ? "解説を開く（生成済み）"
                          : "この文について質問・文法解説"
                    }
                    onClick={() => toggle(setOpenGrammar, sentenceKey)}
                  >
                    <PuzzleIcon />
                  </IconButton>
                ) : (
                  <span className="h-7 w-7" aria-hidden />
                )}
              </div>
            </div>

            {showTranslation && isSentenceEnd && (
              <p className="break-words text-sm text-zinc-500">{line.translation}</p>
            )}

            {/* 文法解説は1文につき1つ。対訳と同じく文の最終行の下に出す */}
            {isSentenceEnd && (
              <LineGrammarPanel
                trackId={trackId}
                lineIndex={sentenceKey}
                open={showGrammar}
                initialGrammar={unitHead.grammar}
                initialMessages={unitHead.chatMessages}
                onGeneratedChange={(g) => markGenerated(sentenceKey, g)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
