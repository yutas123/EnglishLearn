"use client";

import { useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type Line = {
  id: string;
  lineIndex: number;
  original: string;
  translation: string;
  sectionLabel: string | null;
  isMarked: boolean;
};

export default function ListeningLines({
  trackId,
  lines,
}: {
  trackId: string;
  lines: Line[];
}) {
  const [marked, setMarked] = useState<Set<number>>(
    () => new Set(lines.filter((l) => l.isMarked).map((l) => l.lineIndex))
  );
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [explanations, setExplanations] = useState<Record<number, string>>({});
  const [explaining, setExplaining] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});

  async function toggleMark(lineIndex: number) {
    if (!BACKEND_URL || pending.has(lineIndex)) return;

    setPending((prev) => new Set(prev).add(lineIndex));
    const wasMarked = marked.has(lineIndex);

    // 楽観的更新（タップ操作の反応を速くする）
    setMarked((prev) => {
      const next = new Set(prev);
      if (wasMarked) next.delete(lineIndex);
      else next.add(lineIndex);
      return next;
    });

    try {
      const res = await fetch(`${BACKEND_URL}/api/listening/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId, lineIndex }),
      });
      if (!res.ok) throw new Error("マークの更新に失敗しました");
    } catch {
      // 失敗時は表示を元に戻す
      setMarked((prev) => {
        const next = new Set(prev);
        if (wasMarked) next.add(lineIndex);
        else next.delete(lineIndex);
        return next;
      });
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(lineIndex);
        return next;
      });
    }
  }

  async function handleExplain(lineIndex: number) {
    if (!BACKEND_URL || explaining.has(lineIndex) || explanations[lineIndex]) return;

    setExplaining((prev) => new Set(prev).add(lineIndex));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[lineIndex];
      return next;
    });

    try {
      const res = await fetch(`${BACKEND_URL}/api/listening/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId, lineIndex }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "解説の取得に失敗しました");
      setExplanations((prev) => ({ ...prev, [lineIndex]: data.explanation }));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [lineIndex]: err instanceof Error ? err.message : "エラーが発生しました",
      }));
    } finally {
      setExplaining((prev) => {
        const next = new Set(prev);
        next.delete(lineIndex);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col">
      {lines.map((line, index) => {
        const prevLabel = index > 0 ? lines[index - 1].sectionLabel : null;
        const sectionLabel =
          line.sectionLabel && line.sectionLabel !== prevLabel ? line.sectionLabel : null;
        const isNewSection = Boolean(sectionLabel) && index > 0;
        const isMarked = marked.has(line.lineIndex);

        return (
          <div
            key={line.id}
            className={`flex flex-col gap-1 py-3 ${
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

            <button
              onClick={() => toggleMark(line.lineIndex)}
              className={`w-fit break-words rounded px-1 -mx-1 text-left font-medium leading-relaxed transition ${
                isMarked
                  ? "border-l-4 border-rose-400 bg-rose-50 pl-2"
                  : "hover:bg-zinc-50"
              }`}
              title={isMarked ? "タップでマーク解除" : "聞き取れなかったらタップ"}
            >
              {isMarked && <span className="mr-1">👂</span>}
              {line.original}
            </button>

            {isMarked && (
              <details className="ml-1 text-sm text-zinc-500">
                <summary className="cursor-pointer select-none">🔎 確認する</summary>
                <div className="mt-1 flex flex-col gap-1.5 pl-1">
                  <p className="break-words">{line.translation}</p>

                  {explanations[line.lineIndex] ? (
                    <p className="break-words rounded bg-zinc-50 p-2 text-xs text-zinc-600">
                      🗣️ {explanations[line.lineIndex]}
                    </p>
                  ) : (
                    <button
                      onClick={() => handleExplain(line.lineIndex)}
                      disabled={explaining.has(line.lineIndex)}
                      className="w-fit text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-700 disabled:opacity-50"
                    >
                      {explaining.has(line.lineIndex)
                        ? "解説を生成中..."
                        : "🗣️ 聞き取りにくいポイントを解説"}
                    </button>
                  )}

                  {errors[line.lineIndex] && (
                    <p className="text-xs text-red-600">{errors[line.lineIndex]}</p>
                  )}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
