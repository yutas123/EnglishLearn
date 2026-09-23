"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MatchSpan } from "@/lib/vocabMatcher";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type Line = {
  id: string;
  lineIndex: number;
  original: string;
  translation: string;
  explanation: string | null;
  knownSpans: MatchSpan[];
  hardSpans: MatchSpan[];
};

type TaggedSpan = MatchSpan & { kind: "known" | "hard" };

type Selection = {
  lineIndex: number;
  original: string;
  text: string;
  isPhrase: boolean;
  rect: DOMRect;
};

type PopupState =
  | { mode: "menu" }
  | { mode: "loading"; action: "explain" | "register" }
  | { mode: "explanation"; text: string }
  | { mode: "registered"; meaning: string; partOfSpeech: string | null; cefr: string | null }
  | { mode: "error"; message: string };

/**
 * 既知語（known）と難所プリハイライト（hard）をマージし、原文を<mark>で分割表示する
 * （dangerouslySetInnerHTMLは使わない）。重なる場合はknownを優先する。
 */
function renderWithHighlights(text: string, knownSpans: MatchSpan[], hardSpans: MatchSpan[]) {
  const tagged: TaggedSpan[] = [
    ...knownSpans.map((s) => ({ ...s, kind: "known" as const })),
    ...hardSpans.map((s) => ({ ...s, kind: "hard" as const })),
  ].sort((a, b) => a.start - b.start);

  const spans: TaggedSpan[] = [];
  let coveredUntil = 0;
  for (const span of tagged) {
    if (span.start < coveredUntil) continue; // 既存スパンと重なる場合はスキップ
    spans.push(span);
    coveredUntil = span.end;
  }

  if (spans.length === 0) return text;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  spans.forEach((span, i) => {
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start));
    const className =
      span.kind === "known"
        ? "rounded bg-amber-100 px-0.5 text-inherit"
        : "rounded bg-sky-100 px-0.5 text-inherit underline decoration-dotted decoration-sky-400";
    nodes.push(
      <mark key={i} className={className} title={span.kind === "hard" ? "難所（要チェック）" : undefined}>
        {text.slice(span.start, span.end)}
      </mark>
    );
    cursor = span.end;
  });

  if (cursor < text.length) nodes.push(text.slice(cursor));

  return nodes;
}

export default function LyricsList({
  trackId,
  lines,
}: {
  trackId: string;
  lines: Line[];
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [popup, setPopup] = useState<PopupState>({ mode: "menu" });

  useEffect(() => {
    function evaluateSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      const text = sel.toString().trim();
      if (!text) return;

      const anchorEl =
        sel.anchorNode?.nodeType === Node.TEXT_NODE
          ? sel.anchorNode.parentElement
          : (sel.anchorNode as HTMLElement | null);
      const lineEl = anchorEl?.closest<HTMLElement>("[data-line-index]");
      if (!lineEl || !containerRef.current?.contains(lineEl)) return;

      const lineIndex = Number(lineEl.dataset.lineIndex);
      const original = lineEl.dataset.original ?? "";
      const rect = sel.getRangeAt(0).getBoundingClientRect();

      setSelection({
        lineIndex,
        original,
        text,
        isPhrase: text.split(/\s+/).length > 1,
        rect,
      });
      setPopup({ mode: "menu" });
    }

    // PC: mouseupで即座に反応
    function handleMouseUp() {
      evaluateSelection();
    }

    // スマホ: 選択ハンドルのドラッグではmouseup/touchendが確実に発火しないため、
    // selectionchangeを正としてデバウンスしながら監視する
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function handleSelectionChange() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(evaluateSelection, 200);
    }

    // ポインタダウン（マウス/タッチ/ペン共通）で新しい選択操作が始まったらポップアップを一旦閉じる
    function handlePointerDown(e: PointerEvent) {
      if ((e.target as HTMLElement)?.closest("[data-vocab-popup]")) return;
      setSelection(null);
    }

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("pointerdown", handlePointerDown);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  async function handleExplain() {
    if (!selection || !BACKEND_URL) return;
    setPopup({ mode: "loading", action: "explain" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/vocab/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          lineIndex: selection.lineIndex,
          selectedText: selection.text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "解説の取得に失敗しました");
      setPopup({ mode: "explanation", text: data.explanation });
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  async function handleRegister() {
    if (!selection || !BACKEND_URL) return;
    setPopup({ mode: "loading", action: "register" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/vocab/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term: selection.text,
          isPhrase: selection.isPhrase,
          trackId,
          lineIndex: selection.lineIndex,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録に失敗しました");
      setPopup({
        mode: "registered",
        meaning: data.meaning,
        partOfSpeech: data.partOfSpeech,
        cefr: data.cefr,
      });
      router.refresh();
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  return (
    <div ref={containerRef} className="relative flex flex-col divide-y divide-zinc-100">
      {lines.map((line) => (
        <div
          key={line.id}
          data-line-index={line.lineIndex}
          data-original={line.original}
          className="flex flex-col gap-1 py-3"
        >
          <p className="break-words font-medium leading-relaxed">
            {renderWithHighlights(line.original, line.knownSpans, line.hardSpans)}
          </p>
          {line.translation && (
            <p className="break-words text-sm text-zinc-500">{line.translation}</p>
          )}
          {line.explanation && (
            <details className="text-sm text-zinc-400">
              <summary className="cursor-pointer select-none italic">💡 解説</summary>
              <p className="mt-1 break-words">{line.explanation}</p>
            </details>
          )}
        </div>
      ))}

      {selection && (
        <div
          data-vocab-popup
          className="fixed z-50 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg"
          style={{
            top: Math.min(selection.rect.bottom + 8, window.innerHeight - 160),
            left: Math.min(Math.max(8, selection.rect.left), window.innerWidth - 280 - 8),
            maxWidth: 280,
          }}
        >
          {popup.mode === "menu" && (
            <div className="flex gap-2">
              <button
                onClick={handleExplain}
                className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
              >
                詳しく!
              </button>
              <button
                onClick={handleRegister}
                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
              >
                📔 登録
              </button>
              <button
                onClick={() => setSelection(null)}
                className="ml-auto text-xs text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>
          )}

          {popup.mode === "loading" && (
            <p className="text-xs text-zinc-500">
              {popup.action === "explain" ? "解説を生成中..." : "登録中..."}
            </p>
          )}

          {popup.mode === "explanation" && (
            <>
              <p className="break-words leading-relaxed text-zinc-700">{popup.text}</p>
              <button
                onClick={() => setSelection(null)}
                className="w-fit text-xs text-zinc-400 hover:text-zinc-600"
              >
                閉じる
              </button>
            </>
          )}

          {popup.mode === "registered" && (
            <>
              <p className="text-xs font-medium text-emerald-700">📔 単語帳に登録しました</p>
              <p className="break-words text-zinc-700">
                {popup.partOfSpeech && (
                  <span className="mr-1 text-zinc-400">[{popup.partOfSpeech}]</span>
                )}
                {popup.meaning}
                {popup.cefr && <span className="ml-1 text-zinc-400">({popup.cefr})</span>}
              </p>
              <button
                onClick={() => setSelection(null)}
                className="w-fit text-xs text-zinc-400 hover:text-zinc-600"
              >
                閉じる
              </button>
            </>
          )}

          {popup.mode === "error" && (
            <>
              <p className="break-words text-xs text-red-600">{popup.message}</p>
              <button
                onClick={() => setSelection(null)}
                className="w-fit text-xs text-zinc-400 hover:text-zinc-600"
              >
                閉じる
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
