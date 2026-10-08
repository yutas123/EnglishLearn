"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { KnownSpan, MatchSpan } from "@/lib/vocabMatcher";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

// コアイメージ帳に保存した用法（保存した行の選択箇所にだけ紫マーカーを付ける）
export type CoreSpan = MatchSpan & {
  usageId: string;
  entryId: string;
  term: string;
  coreImage: string;
  roleInLine: string;
  translation: string;
  illustrationVersion: number | null;
};

type Line = {
  id: string;
  lineIndex: number;
  original: string;
  translation: string;
  explanation: string | null;
  sectionLabel: string | null;
  knownSpans: KnownSpan[];
  hardSpans: MatchSpan[];
  coreSpans: CoreSpan[];
};

// マーカー層（背景色）。コアイメージ（下線層）とは独立して重ねて描画する
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
  existingCoreUsageId?: string;
};

type PopupState =
  | { mode: "menu" }
  | {
      mode: "loading";
      action: "explain" | "coreImage" | "saveCore" | "deleteCore" | "preview" | "register" | "delete";
    }
  | { mode: "explanation"; text: string }
  | {
      mode: "coreImage";
      coreImage: string;
      roleInLine: string;
      translation: string;
      saved: boolean;
    }
  | {
      mode: "viewCore";
      usageId: string;
      entryId: string;
      term: string;
      coreImage: string;
      roleInLine: string;
      translation: string;
      illustrationVersion: number | null;
      // 同じ箇所に登録/解説のマーカーも重なっているとき、そちらへ切り替えるための情報
      alsoKnown?: { span: KnownSpan; text: string };
      coreSpan: CoreSpan;
    }
  | {
      mode: "confirm";
      term: string;
      meaning: string;
      partOfSpeech: string | null;
      cefr: string | null;
      ipa: string | null;
      explanation: string | null;
      isExisting: boolean;
      // 複数語選択で「まとまりで覚える価値が低い」と判定されたときの、鍵となる1語
      coreWord: string | null;
    }
  | {
      mode: "registered";
      meaning: string;
      partOfSpeech: string | null;
      cefr: string | null;
      ipa: string | null;
    }
  | {
      mode: "viewEntry";
      vocabEntryId: string;
      term: string;
      meaning: string;
      partOfSpeech: string | null;
      cefr: string | null;
      ipa: string | null;
      explanation: string | null;
      isOriginTrack: boolean;
      // 同じ箇所にコアイメージの下線も重なっているとき、そちらへ切り替えるための情報
      alsoCore?: { span: CoreSpan; text: string };
      knownSpan: KnownSpan;
    }
  | { mode: "error"; message: string };

/**
 * 2つのレイヤーを重ねて原文を描画する（dangerouslySetInnerHTMLは使わない）。
 * - マーカー層（背景色）: 既知語（known）と難所（hard）。重なる場合はknownを優先
 * - 下線層（ピンクの下線）: コアイメージ帳に保存した用法
 * 両者が同じ箇所に重なっても、マーカーの上に下線が付いて両方見える。
 */
function renderWithHighlights(
  text: string,
  knownSpans: KnownSpan[],
  hardSpans: MatchSpan[],
  coreSpans: CoreSpan[],
  onKnownClick: (
    span: KnownSpan,
    el: HTMLElement,
    matchedText: string,
    alsoCore?: { span: CoreSpan; text: string }
  ) => void,
  onCoreClick: (
    span: CoreSpan,
    el: HTMLElement,
    matchedText: string,
    alsoKnown?: { span: KnownSpan; text: string }
  ) => void
) {
  const tagged: TaggedSpan[] = [
    ...knownSpans.map((s) => ({ ...s, kind: "known" as const })),
    ...hardSpans.map((s) => ({ ...s, kind: "hard" as const })),
  ].sort((a, b) => a.start - b.start);

  const markers: TaggedSpan[] = [];
  let markerCoveredUntil = 0;
  for (const span of tagged) {
    if (span.start < markerCoveredUntil) continue; // 既存スパンと重なる場合はスキップ
    markers.push(span);
    markerCoveredUntil = span.end;
  }

  const cores: CoreSpan[] = [];
  let coreCoveredUntil = 0;
  for (const span of [...coreSpans].sort((a, b) => a.start - b.start)) {
    if (span.start < coreCoveredUntil) continue;
    cores.push(span);
    coreCoveredUntil = span.end;
  }

  if (markers.length === 0 && cores.length === 0) return text;

  // 境界点で区切り、区間ごとに「どのマーカー・どのコア用法に覆われているか」を求める
  const points = new Set<number>([0, text.length]);
  for (const span of [...markers, ...cores]) {
    points.add(Math.max(0, Math.min(text.length, span.start)));
    points.add(Math.max(0, Math.min(text.length, span.end)));
  }
  const sorted = [...points].sort((a, b) => a - b);

  type Segment = { start: number; end: number; marker?: TaggedSpan; core?: CoreSpan };
  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const marker = markers.find((m) => m.start <= a && b <= m.end);
    const core = cores.find((c) => c.start <= a && b <= c.end);
    const last = segments[segments.length - 1];
    if (last && last.marker === marker && last.core === core) {
      last.end = b; // 同じ組み合わせが続くなら1つにまとめる
    } else {
      segments.push({ start: a, end: b, marker, core });
    }
  }

  return segments.map((seg, i) => {
    const body = text.slice(seg.start, seg.end);
    const { marker, core } = seg;

    let node: React.ReactNode = body;

    if (marker?.kind === "known") {
      const alsoCore = core
        ? { span: core, text: text.slice(core.start, core.end) }
        : undefined;
      node = (
        <mark
          className="cursor-pointer rounded bg-emerald-100 px-0.5 text-inherit hover:bg-emerald-200"
          title="登録済み（タップで詳細）"
          onClick={(e) => {
            e.stopPropagation(); // 下線（コア）側のクリックと二重に発火させない
            onKnownClick(marker, e.currentTarget, text.slice(marker.start, marker.end), alsoCore);
          }}
        >
          {body}
        </mark>
      );
    } else if (marker?.kind === "hard") {
      node = (
        <mark
          className="rounded bg-sky-100 px-0.5 text-inherit underline decoration-dotted decoration-sky-400"
          title="難所（要チェック）"
        >
          {body}
        </mark>
      );
    }

    if (core) {
      node = (
        <span
          data-core-marker
          className="cursor-pointer underline decoration-pink-500 decoration-2 underline-offset-4"
          title="コアイメージ保存済み（タップで詳細）"
          onClick={(e) =>
            onCoreClick(core, e.currentTarget, text.slice(core.start, core.end))
          }
        >
          {node}
        </span>
      );
    }

    return <span key={i}>{node}</span>;
  });
}

function normalize(s: string) {
  return s.toLowerCase().trim();
}

export default function LyricsList({
  trackId,
  lines,
  title,
  artistName,
}: {
  trackId: string;
  lines: Line[];
  title: string;
  artistName: string;
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
  const [currentSectionLabel, setCurrentSectionLabel] = useState<string | null>(null);
  const [flashLineIndex, setFlashLineIndex] = useState<number | null>(null);

  // 検索結果から #line-N 付きで遷移してきたとき、その行へスクロールして一瞬ハイライトする
  useEffect(() => {
    const match = window.location.hash.match(/^#line-(\d+)$/);
    if (!match) return;
    const lineIndex = Number(match[1]);
    document
      .getElementById(`line-${lineIndex}`)
      ?.scrollIntoView({ block: "center" });
    setFlashLineIndex(lineIndex);
    const timer = setTimeout(() => setFlashLineIndex(null), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Spotifyでこのページの曲が再生中なら、再生位置÷曲の長さを行数に按分して
  // 「だいたい今このセクション」を推定する（行/秒単位の正確な同期ではなく、あくまで目安）
  useEffect(() => {
    if (!BACKEND_URL) return;

    async function pollSection() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/spotify/state`);
        const data = await res.json();

        const isThisTrack =
          data.isPlaying &&
          normalize(data.trackName ?? "") === normalize(title) &&
          normalize(data.artistName ?? "") === normalize(artistName) &&
          typeof data.progressMs === "number" &&
          typeof data.durationMs === "number" &&
          data.durationMs > 0;

        if (!isThisTrack || lines.length === 0) {
          setCurrentSectionLabel(null);
          return;
        }

        const ratio = Math.min(1, Math.max(0, data.progressMs / data.durationMs));
        const estimatedIndex = Math.min(
          lines.length - 1,
          Math.floor(ratio * lines.length)
        );
        setCurrentSectionLabel(lines[estimatedIndex]?.sectionLabel ?? null);
      } catch {
        // 一時的なネットワークエラーはポーリング継続
      }
    }

    pollSection();
    const interval = setInterval(pollSection, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

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
      if ((e.target as HTMLElement)?.closest("mark, [data-core-marker]")) return;
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
    rect: DOMRect,
    matchedText: string,
    lineIndex: number,
    alsoCore?: { span: CoreSpan; text: string }
  ) {
    window.getSelection()?.removeAllRanges();
    setConfirmingDelete(false);
    setContextNote({ loading: false, text: null });
    setSelection({
      lineIndex,
      original: matchedText,
      text: matchedText,
      isPhrase: matchedText.split(/\s+/).length > 1,
      rect,
      existingVocabEntryId: span.vocabEntryId,
    });
    setPopup({
      mode: "viewEntry",
      vocabEntryId: span.vocabEntryId,
      term: span.term,
      meaning: span.meaning,
      partOfSpeech: span.partOfSpeech,
      cefr: span.cefr,
      ipa: span.ipa,
      explanation: span.explanation,
      isOriginTrack: span.sourceTrackId === trackId,
      alsoCore,
      knownSpan: span,
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

  async function handleCoreImage() {
    if (!selection || !BACKEND_URL) return;
    setPopup({ mode: "loading", action: "coreImage" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/vocab/core-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          lineIndex: selection.lineIndex,
          selectedText: selection.text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "コアイメージの取得に失敗しました");
      setPopup({
        mode: "coreImage",
        coreImage: data.coreImage,
        roleInLine: data.roleInLine,
        translation: data.translation,
        saved: false,
      });
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  async function handleSaveCore() {
    if (!selection || !BACKEND_URL || popup.mode !== "coreImage") return;
    const current = popup;
    setPopup({ mode: "loading", action: "saveCore" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/core-image/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          lineIndex: selection.lineIndex,
          selectedText: selection.text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存に失敗しました");
      setPopup({ ...current, saved: true });
      router.refresh();
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  function handleCoreClick(
    span: CoreSpan,
    rect: DOMRect,
    matchedText: string,
    lineIndex: number,
    alsoKnown?: { span: KnownSpan; text: string }
  ) {
    window.getSelection()?.removeAllRanges();
    setConfirmingDelete(false);
    setContextNote({ loading: false, text: null });
    setSelection({
      lineIndex,
      original: matchedText,
      text: matchedText,
      isPhrase: matchedText.split(/\s+/).length > 1,
      rect,
      existingCoreUsageId: span.usageId,
    });
    setPopup({
      mode: "viewCore",
      usageId: span.usageId,
      entryId: span.entryId,
      term: span.term,
      coreImage: span.coreImage,
      roleInLine: span.roleInLine,
      translation: span.translation,
      illustrationVersion: span.illustrationVersion,
      alsoKnown,
      coreSpan: span,
    });
  }

  async function handleDeleteCore() {
    if (!selection?.existingCoreUsageId || !BACKEND_URL) return;

    setPopup({ mode: "loading", action: "deleteCore" });
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/core-image/usage/${selection.existingCoreUsageId}`,
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

  async function handlePreviewRegister(override?: { text: string; isPhrase: boolean }) {
    if (!selection || !BACKEND_URL) return;
    const target = override ?? { text: selection.text, isPhrase: selection.isPhrase };
    setPopup({ mode: "loading", action: "preview" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/vocab/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term: target.text,
          isPhrase: target.isPhrase,
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
        ipa: data.ipa,
        explanation: lastExplanation,
        isExisting: data.isExisting,
        coreWord: data.coreWord ?? null,
      });
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  // 「まとまりで覚える価値が低い」と判定された複数語選択を、鍵となる1語の登録に切り替える
  function handleSwitchToCoreWord(coreWord: string) {
    setSelection((s) => (s ? { ...s, text: coreWord, isPhrase: false } : s));
    handlePreviewRegister({ text: coreWord, isPhrase: false });
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
          ipa: confirmed.ipa,
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
        ipa: data.ipa,
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
    <div ref={containerRef} className="relative flex flex-col">
      {lines.map((line, index) => {
        const prevLabel = index > 0 ? lines[index - 1].sectionLabel : null;
        const sectionLabel =
          line.sectionLabel && line.sectionLabel !== prevLabel ? line.sectionLabel : null;
        const isNewSection = Boolean(sectionLabel) && index > 0;
        const isCurrentSection =
          Boolean(currentSectionLabel) && line.sectionLabel === currentSectionLabel;

        return (
        <div
          key={line.id}
          id={`line-${line.lineIndex}`}
          data-line-index={line.lineIndex}
          data-original={line.original}
          className={`flex scroll-mt-20 flex-col gap-1 py-3 transition-colors duration-700 ${
            flashLineIndex === line.lineIndex ? "bg-amber-100" : ""
          } ${
            isNewSection ? "border-t border-zinc-200 pt-4" : ""
          }`}
        >
          {sectionLabel && (
            <div
              className={`mb-1 text-xs font-semibold tracking-wide transition-colors duration-500 ${
                isCurrentSection ? "text-amber-600" : ""
              }`}
              style={isCurrentSection ? undefined : { color: "rgb(117 117 125)" }}
            >
              {isCurrentSection && "▶ "}[{sectionLabel}]
            </div>
          )}
          <p className="break-words font-medium leading-relaxed">
            {renderWithHighlights(
              line.original,
              line.knownSpans,
              line.hardSpans,
              line.coreSpans,
              (span, el, matchedText, alsoCore) =>
                handleKnownClick(span, el.getBoundingClientRect(), matchedText, line.lineIndex, alsoCore),
              (span, el, matchedText, alsoKnown) =>
                handleCoreClick(span, el.getBoundingClientRect(), matchedText, line.lineIndex, alsoKnown)
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
        );
      })}

      {selection && (
        <div
          data-vocab-popup
          className="fixed z-50 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg"
          style={(() => {
            const vh = window.innerHeight;
            // iOS標準のコピー/調べるメニューが選択範囲の上に出るため、常に下に表示する
            const space = Math.max(120, vh - selection.rect.bottom - 16);
            return {
              top: selection.rect.bottom + 8,
              left: Math.min(Math.max(8, selection.rect.left), window.innerWidth - 280 - 8),
              maxWidth: 280,
              maxHeight: space,
              overflowY: "auto" as const,
            };
          })()}
        >
          {popup.mode === "menu" && (
            <div className="flex gap-2">
              <button
                onClick={handleExplain}
                className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
              >
                詳しく!
              </button>
              {selection.text.trim().split(/\s+/).length <= 2 && (
                <button
                  onClick={handleCoreImage}
                  className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                >
                  🧠 コア
                </button>
              )}
              <button
                onClick={() => handlePreviewRegister()}
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
              {popup.action === "coreImage" && "コアイメージを生成中..."}
              {popup.action === "saveCore" && "保存中..."}
              {popup.action === "deleteCore" && "削除中..."}
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
                  onClick={() => handlePreviewRegister()}
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

          {popup.mode === "coreImage" && (
            <>
              <div className="flex flex-col gap-1.5 leading-relaxed text-zinc-700">
                <p className="break-words">
                  <span className="block text-xs font-medium text-zinc-400">🧠 コアイメージ</span>
                  {popup.coreImage}
                </p>
                <p className="break-words">
                  <span className="block text-xs font-medium text-zinc-400">この行での働き</span>
                  {popup.roleInLine}
                </p>
                <p className="break-words">
                  <span className="block text-xs font-medium text-zinc-400">この文脈での訳し方</span>
                  {popup.translation}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {popup.saved ? (
                  <span className="text-xs font-medium text-pink-600">
                    ✓ コアイメージ帳に保存しました
                  </span>
                ) : (
                  <button
                    onClick={handleSaveCore}
                    className="w-fit rounded-full border border-pink-300 px-3 py-1 text-xs font-medium text-pink-600 hover:bg-pink-50"
                  >
                    🧠 保存
                  </button>
                )}
                <button
                  onClick={closePopup}
                  className="text-xs text-zinc-400 hover:text-zinc-600"
                >
                  閉じる
                </button>
              </div>
            </>
          )}

          {popup.mode === "viewCore" && (
            <>
              <p className="break-words font-semibold text-zinc-800">{popup.term}</p>
              {popup.illustrationVersion && BACKEND_URL && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${BACKEND_URL}/api/core-image/${popup.entryId}/illustration?v=${popup.illustrationVersion}`}
                  alt={`${popup.term} のイメージ`}
                  className="w-full rounded"
                />
              )}
              <div className="flex flex-col gap-1.5 leading-relaxed text-zinc-700">
                <p className="break-words">
                  <span className="block text-xs font-medium text-zinc-400">🧠 コアイメージ</span>
                  {popup.coreImage}
                </p>
                <p className="break-words">
                  <span className="block text-xs font-medium text-zinc-400">この行での働き</span>
                  {popup.roleInLine}
                </p>
                <p className="break-words">
                  <span className="block text-xs font-medium text-zinc-400">この文脈での訳し方</span>
                  {popup.translation}
                </p>
              </div>
              {popup.alsoKnown && selection && (
                <button
                  onClick={() =>
                    handleKnownClick(
                      popup.alsoKnown!.span,
                      selection.rect,
                      popup.alsoKnown!.text,
                      selection.lineIndex,
                      { span: popup.coreSpan, text: selection.text }
                    )
                  }
                  className="w-fit text-xs text-emerald-700 underline decoration-dotted hover:text-emerald-800"
                >
                  📔 登録内容も見る
                </button>
              )}

              {confirmingDelete ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDeleteCore}
                    className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    削除する
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="text-xs text-zinc-400 hover:text-zinc-600"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    className="w-fit rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    削除
                  </button>
                  <button
                    onClick={closePopup}
                    className="text-xs text-zinc-400 hover:text-zinc-600"
                  >
                    閉じる
                  </button>
                </div>
              )}
            </>
          )}

          {popup.mode === "confirm" && (
            <>
              <p className="text-xs font-medium text-zinc-500">
                {popup.isExisting ? "この語彙は登録済みです" : "以下の内容で登録します"}
              </p>
              <p className="break-words font-semibold text-zinc-800">
                {popup.term}
                {popup.ipa && (
                  <span className="ml-2 font-normal text-zinc-400">{popup.ipa}</span>
                )}
              </p>
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
              {popup.coreWord && (
                <div className="flex flex-col gap-1.5 rounded bg-amber-50 p-2">
                  <p className="text-xs text-amber-800">
                    これは決まった慣用表現ではなく、通常の文法の組み合わせです。つまずきの原因は
                    「{popup.coreWord}」の意味かもしれません。
                  </p>
                  <button
                    onClick={() => handleSwitchToCoreWord(popup.coreWord!)}
                    className="w-fit rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    「{popup.coreWord}」を登録する
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleConfirmRegister}
                  className={
                    popup.coreWord
                      ? "w-fit rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                      : "w-fit rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
                  }
                >
                  {popup.coreWord ? "フレーズのまま登録する" : "登録する"}
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
                {popup.ipa && <span className="mr-1 text-zinc-400">{popup.ipa}</span>}
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
                <p className="break-words font-semibold text-zinc-800">
                  {popup.term}
                  {popup.ipa && (
                    <span className="ml-2 font-normal text-zinc-400">{popup.ipa}</span>
                  )}
                </p>
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

              {popup.alsoCore && selection && (
                <button
                  onClick={() =>
                    handleCoreClick(
                      popup.alsoCore!.span,
                      selection.rect,
                      popup.alsoCore!.text,
                      selection.lineIndex,
                      { span: popup.knownSpan, text: selection.text }
                    )
                  }
                  className="w-fit text-xs text-pink-600 underline decoration-dotted hover:text-pink-700"
                >
                  🧠 コアイメージも見る
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
