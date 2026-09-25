"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { KnownSpan, MatchSpan } from "@/lib/vocabMatcher";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type Line = {
  id: string;
  lineIndex: number;
  original: string;
  translation: string;
  explanation: string | null;
  knownSpans: KnownSpan[];
  hardSpans: MatchSpan[];
};

type TaggedSpan =
  | (MatchSpan & { kind: "hard" })
  | (KnownSpan & { kind: "known" });

// ドラッグ選択で新規に選んだ範囲か、既存の登録済みマーカーをクリックしたのかを区別する
type Selection = {
  lineIndex: number;
  original: string;
  text: string;
  isPhrase: boolean;
  rect: DOMRect;
  existingVocabEntryId?: string;
};

type PopupState =
  | { mode: "menu" }
  | { mode: "loading"; action: "explain" | "preview" | "register" | "delete" }
  | { mode: "explanation"; text: string }
  | {
      mode: "confirm";
      term: string;
      meaning: string;
      partOfSpeech: string | null;
      cefr: string | null;
      explanation: string | null;
      isExisting: boolean;
    }
  | { mode: "registered"; meaning: string; partOfSpeech: string | null; cefr: string | null }
  | {
      mode: "viewEntry";
      vocabEntryId: string;
      term: string;
      meaning: string;
      partOfSpeech: string | null;
      cefr: string | null;
      explanation: string | null;
      isOriginTrack: boolean;
    }
  | { mode: "error"; message: string };

/**
 * 既知語（known）と難所プリハイライト（hard）をマージし、原文を<mark>で分割表示する
 * （dangerouslySetInnerHTMLは使わない）。重なる場合はknownを優先する。
 */
function renderWithHighlights(
  text: string,
  knownSpans: KnownSpan[],
  hardSpans: MatchSpan[],
  onKnownClick: (span: KnownSpan, el: HTMLElement, matchedText: string) => void
) {
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

    if (span.kind === "known") {
      nodes.push(
        <mark
          key={i}
          className="cursor-pointer rounded bg-emerald-100 px-0.5 text-inherit hover:bg-emerald-200"
          title="登録済み（タップで詳細）"
          onClick={(e) =>
            onKnownClick(span, e.currentTarget, text.slice(span.start, span.end))
          }
        >
          {text.slice(span.start, span.end)}
        </mark>
      );
    } else {
      nodes.push(
        <mark
          key={i}
          className="rounded bg-sky-100 px-0.5 text-inherit underline decoration-dotted decoration-sky-400"
          title="難所（要チェック）"
        >
          {text.slice(span.start, span.end)}
        </mark>
      );
    }
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
  const [lastExplanation, setLastExplanation] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [contextNote, setContextNote] = useState<{ loading: boolean; text: string | null }>({
    loading: false,
    text: null,
  });

  function closePopup() {
    setSelection(null);
    setConfirmingDelete(false);
    setContextNote({ loading: false, text: null });
  }

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
      setLastExplanation(null);
      setConfirmingDelete(false);
      setContextNote({ loading: false, text: null });
      setPopup({ mode: "menu" });
    }

    // PC: mouseupで即座に反応。ただしポップアップ内のボタン操作（登録するなど）では、
    // クリック時点で古いテキスト選択がまだ残っていることがあり、それを新規選択と誤認して
    // ポップアップの状態を巻き戻してしまうことがあるため、ポップアップ内でのmouseupは無視する
    function handleMouseUp(e: MouseEvent) {
      if ((e.target as HTMLElement)?.closest("[data-vocab-popup]")) return;
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
      if ((e.target as HTMLElement)?.closest("mark")) return;
      setSelection(null);
      setConfirmingDelete(false);
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

  function handleKnownClick(
    span: KnownSpan,
    el: HTMLElement,
    matchedText: string,
    lineIndex: number
  ) {
    window.getSelection()?.removeAllRanges();
    setConfirmingDelete(false);
    setContextNote({ loading: false, text: null });
    setSelection({
      lineIndex,
      original: matchedText,
      text: matchedText,
      isPhrase: matchedText.split(/\s+/).length > 1,
      rect: el.getBoundingClientRect(),
      existingVocabEntryId: span.vocabEntryId,
    });
    setPopup({
      mode: "viewEntry",
      vocabEntryId: span.vocabEntryId,
      term: span.term,
      meaning: span.meaning,
      partOfSpeech: span.partOfSpeech,
      cefr: span.cefr,
      explanation: span.explanation,
      isOriginTrack: span.sourceTrackId === trackId,
    });
  }

  async function handleExplainContext() {
    if (!selection || !BACKEND_URL || selection.lineIndex < 0) return;
    setContextNote({ loading: true, text: null });
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
      setContextNote({ loading: false, text: data.explanation });
    } catch (err) {
      setContextNote({
        loading: false,
        text: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

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
      setLastExplanation(data.explanation);
      setPopup({ mode: "explanation", text: data.explanation });
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  async function handlePreviewRegister() {
    if (!selection || !BACKEND_URL) return;
    setPopup({ mode: "loading", action: "preview" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/vocab/preview`, {
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
      if (!res.ok) throw new Error(data.error ?? "登録内容の取得に失敗しました");
      setPopup({
        mode: "confirm",
        term: data.term,
        meaning: data.meaning,
        partOfSpeech: data.partOfSpeech,
        cefr: data.cefr,
        explanation: lastExplanation,
        isExisting: data.isExisting,
      });
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  async function handleConfirmRegister() {
    if (!selection || !BACKEND_URL || popup.mode !== "confirm") return;
    const confirmed = popup;
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
          meaning: confirmed.meaning,
          partOfSpeech: confirmed.partOfSpeech,
          cefr: confirmed.cefr,
          explanation: confirmed.explanation,
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

  async function handleDeleteEntry() {
    if (!selection?.existingVocabEntryId || !BACKEND_URL) return;

    setPopup({ mode: "loading", action: "delete" });
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/vocab/${selection.existingVocabEntryId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "削除に失敗しました");
      }
      closePopup();
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
            {renderWithHighlights(line.original, line.knownSpans, line.hardSpans, (span, el, matchedText) =>
              handleKnownClick(span, el, matchedText, line.lineIndex)
            )}
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
                onClick={handlePreviewRegister}
                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
              >
                📔 登録
              </button>
              <button
                onClick={closePopup}
                className="ml-auto text-xs text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>
          )}

          {popup.mode === "loading" && (
            <p className="text-xs text-zinc-500">
              {popup.action === "explain" && "解説を生成中..."}
              {popup.action === "preview" && "登録内容を確認中..."}
              {popup.action === "register" && "登録中..."}
              {popup.action === "delete" && "削除中..."}
            </p>
          )}

          {popup.mode === "explanation" && (
            <>
              <p className="break-words leading-relaxed text-zinc-700">{popup.text}</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePreviewRegister}
                  className="w-fit rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-50"
                >
                  📔 登録
                </button>
                <button
                  onClick={closePopup}
                  className="text-xs text-zinc-400 hover:text-zinc-600"
                >
                  閉じる
                </button>
              </div>
            </>
          )}

          {popup.mode === "confirm" && (
            <>
              <p className="text-xs font-medium text-zinc-500">
                {popup.isExisting ? "この語彙は登録済みです" : "以下の内容で登録します"}
              </p>
              <p className="break-words font-semibold text-zinc-800">{popup.term}</p>
              <p className="break-words text-zinc-700">
                {popup.partOfSpeech && (
                  <span className="mr-1 text-zinc-400">[{popup.partOfSpeech}]</span>
                )}
                {popup.meaning}
                {popup.cefr && <span className="ml-1 text-zinc-400">({popup.cefr})</span>}
              </p>
              {popup.explanation && (
                <p className="break-words rounded bg-zinc-50 p-2 text-xs text-zinc-500">
                  {popup.explanation}
                </p>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleConfirmRegister}
                  className="w-fit rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
                >
                  登録する
                </button>
                <button
                  onClick={closePopup}
                  className="text-xs text-zinc-400 hover:text-zinc-600"
                >
                  キャンセル
                </button>
              </div>
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
                onClick={closePopup}
                className="w-fit text-xs text-zinc-400 hover:text-zinc-600"
              >
                閉じる
              </button>
            </>
          )}

          {popup.mode === "viewEntry" && (
            <>
              <div className="flex items-start justify-between gap-2">
                <p className="break-words font-semibold text-zinc-800">{popup.term}</p>
                <button
                  onClick={closePopup}
                  aria-label="閉じる"
                  className="shrink-0 text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>
              <p className="break-words text-zinc-700">
                {popup.partOfSpeech && (
                  <span className="mr-1 text-zinc-400">[{popup.partOfSpeech}]</span>
                )}
                {popup.meaning}
                {popup.cefr && <span className="ml-1 text-zinc-400">({popup.cefr})</span>}
              </p>
              {popup.isOriginTrack && popup.explanation ? (
                <p className="break-words rounded bg-zinc-50 p-2 text-xs text-zinc-600">
                  {popup.explanation}
                </p>
              ) : contextNote.text ? (
                <p className="break-words rounded bg-zinc-50 p-2 text-xs text-zinc-600">
                  {contextNote.text}
                </p>
              ) : (
                <button
                  onClick={handleExplainContext}
                  disabled={contextNote.loading}
                  className="w-fit text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-700 disabled:opacity-50"
                >
                  {contextNote.loading ? "この曲での意味を確認中..." : "🔍 この曲での意味を見る"}
                </button>
              )}

              {confirmingDelete ? (
                <div className="flex flex-col gap-1.5 rounded bg-red-50 p-2">
                  <p className="text-xs text-red-700">
                    単語帳から削除しますか？（すべての出現箇所から消えます）
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleDeleteEntry}
                      className="w-fit rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                    >
                      削除する
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      className="text-xs text-zinc-500 hover:text-zinc-700"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="w-fit text-xs text-red-500 hover:text-red-700"
                >
                  削除
                </button>
              )}
            </>
          )}

          {popup.mode === "error" && (
            <>
              <p className="break-words text-xs text-red-600">{popup.message}</p>
              <button
                onClick={closePopup}
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
