"use client";

import { useState } from "react";
import LineGrammarPanel, { type ChatMessage, type Grammar } from "./LineGrammarPanel";

type Line = {
  id: string;
  lineIndex: number;
  original: string;
  translation: string;
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
  label,
  onClick,
  children,
}: {
  active: boolean;
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
        active ? "bg-sky-100 text-sky-700" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
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
        const showTranslation = shownTranslations.has(line.lineIndex);
        const showGrammar = openGrammar.has(line.lineIndex);

        return (
          <div
            key={line.id}
            className={`flex flex-col gap-1 py-2.5 ${
              isNewSection ? "border-t border-zinc-200 pt-4" : ""
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
                <IconButton
                  active={showTranslation}
                  label={showTranslation ? "対訳を閉じる" : "対訳を表示"}
                  onClick={() => toggle(setShownTranslations, line.lineIndex)}
                >
                  <TextIcon />
                </IconButton>
                <IconButton
                  active={showGrammar}
                  label={showGrammar ? "文法解説を閉じる" : "文法を解体する"}
                  onClick={() => toggle(setOpenGrammar, line.lineIndex)}
                >
                  <PuzzleIcon />
                </IconButton>
              </div>
            </div>

            {showTranslation && (
              <p className="break-words text-sm text-zinc-500">{line.translation}</p>
            )}

            <LineGrammarPanel
              trackId={trackId}
              lineIndex={line.lineIndex}
              open={showGrammar}
              initialGrammar={line.grammar}
              initialMessages={line.chatMessages}
            />
          </div>
        );
      })}
    </div>
  );
}
