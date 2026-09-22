"use client";

import { useRef, useState } from "react";

type Highlight = {
  id: string;
  lineIndex: number;
  startOffset: number;
  endOffset: number;
};

type Line = {
  id: string;
  lineIndex: number;
  original: string;
  translation: string;
  explanation: string | null;
};

/**
 * Range境界(node, offset)を、containerを起点とした文字オフセットに変換する
 */
function getOffsetWithin(container: Node, node: Node, offset: number): number {
  let total = 0;
  let found = false;

  function walk(n: Node) {
    if (found) return;
    if (n === node) {
      total += offset;
      found = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      total += n.textContent?.length ?? 0;
    } else {
      n.childNodes.forEach(walk);
    }
  }

  walk(container);
  return total;
}

function renderWithHighlights(text: string, highlights: Highlight[]) {
  if (highlights.length === 0) return text;

  const sorted = [...highlights]
    .map((h) => ({
      start: Math.max(0, Math.min(h.startOffset, h.endOffset)),
      end: Math.min(text.length, Math.max(h.startOffset, h.endOffset)),
    }))
    .sort((a, b) => a.start - b.start);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  sorted.forEach((h, i) => {
    if (h.start > cursor) {
      nodes.push(text.slice(cursor, h.start));
    }
    if (h.end > Math.max(h.start, cursor)) {
      const from = Math.max(h.start, cursor);
      nodes.push(
        <mark key={i} className="highlight">
          {text.slice(from, h.end)}
        </mark>
      );
      cursor = h.end;
    }
  });

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function LyricLine({
  trackId,
  line,
  initialHighlights,
}: {
  trackId: string;
  line: Line;
  initialHighlights: Highlight[];
}) {
  const [highlights, setHighlights] = useState(initialHighlights);
  const containerRef = useRef<HTMLParagraphElement>(null);

  async function handleMouseUp() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !containerRef.current) return;

    const range = selection.getRangeAt(0);
    if (!containerRef.current.contains(range.commonAncestorContainer)) return;

    const startOffset = getOffsetWithin(
      containerRef.current,
      range.startContainer,
      range.startOffset
    );
    const endOffset = getOffsetWithin(
      containerRef.current,
      range.endContainer,
      range.endOffset
    );

    const start = Math.min(startOffset, endOffset);
    const end = Math.max(startOffset, endOffset);
    if (start === end) return;

    selection.removeAllRanges();

    // 即時反映（楽観的更新）
    const optimistic: Highlight = {
      id: `tmp-${Date.now()}`,
      lineIndex: line.lineIndex,
      startOffset: start,
      endOffset: end,
    };
    setHighlights((prev) => [...prev, optimistic]);

    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          lineIndex: line.lineIndex,
          startOffset: start,
          endOffset: end,
        }),
      });
      const saved = await res.json();
      setHighlights((prev) =>
        prev.map((h) => (h.id === optimistic.id ? saved : h))
      );
    } catch {
      setHighlights((prev) => prev.filter((h) => h.id !== optimistic.id));
    }
  }

  return (
    <div className="flex flex-col gap-1 py-3">
      <p
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="select-text font-medium leading-relaxed"
      >
        {renderWithHighlights(line.original, highlights)}
      </p>
      {line.translation && (
        <p className="text-sm text-zinc-500">{line.translation}</p>
      )}
      {line.explanation && (
        <details className="text-xs text-zinc-400">
          <summary className="cursor-pointer select-none italic">
            💡 解説
          </summary>
          <p className="mt-1">{line.explanation}</p>
        </details>
      )}
    </div>
  );
}

export default function HighlightableLyrics({
  trackId,
  lines,
  highlights,
}: {
  trackId: string;
  lines: Line[];
  highlights: Highlight[];
}) {
  return (
    <div className="flex flex-col divide-y divide-zinc-100">
      {lines.map((line) => (
        <LyricLine
          key={line.id}
          trackId={trackId}
          line={line}
          initialHighlights={highlights.filter(
            (h) => h.lineIndex === line.lineIndex
          )}
        />
      ))}
    </div>
  );
}
