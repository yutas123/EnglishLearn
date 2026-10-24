"use client";

import { useState } from "react";
import { MEMBERS, type MemberKey, type Voice } from "@/lib/beatles";

export type VocalScope = "line" | "section";

/**
 * 行の下線（誰が歌っているか）を編集する下部シート。
 * voices は上から順（音程の高い順）。保存範囲は「この行だけ」か「同じ見出しの連続する行すべて」。
 */
export default function VocalEditor({
  lineText,
  initialVoices,
  sectionLabel,
  sectionLineCount,
  saving,
  error,
  onSave,
  onReset,
  onClose,
}: {
  lineText: string;
  initialVoices: Voice[];
  sectionLabel: string | null;
  sectionLineCount: number;
  saving: boolean;
  error: string | null;
  onSave: (voices: Voice[], scope: VocalScope) => void;
  onReset: (scope: VocalScope) => void;
  onClose: () => void;
}) {
  const [voices, setVoices] = useState<Voice[]>(initialVoices);
  const [scope, setScope] = useState<VocalScope>("line");

  const update = (index: number, patch: Partial<Voice>) =>
    setVoices((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  const move = (index: number, delta: number) =>
    setVoices((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const used = new Set(voices.map((v) => v.member));

  return (
    <div
      data-vocal-editor
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-h-[70vh] w-auto max-w-2xl flex-col gap-3 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words font-medium">{lineText}</p>
        <button onClick={onClose} className="shrink-0 text-xs text-zinc-400 hover:text-zinc-600">
          ✕ 閉じる
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-zinc-400">上の線ほど音程が高い（▲▼で並べ替え）</p>
        {voices.length === 0 && <p className="text-xs text-zinc-500">線なし</p>}
        {voices.map((v, i) => (
          <div key={v.member} className="flex flex-wrap items-center gap-2">
            <span
              className="inline-block h-[3px] w-5 rounded-full"
              style={{ backgroundColor: MEMBERS[v.member].color }}
            />
            <span className="w-14 text-xs font-medium">{MEMBERS[v.member].name}</span>
            <button
              onClick={() => update(i, { role: v.role === "L" ? "H" : "L" })}
              className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50"
            >
              {v.role === "L" ? "リード" : "ハモリ"}
            </button>
            <button
              onClick={() => update(i, { double: !v.double })}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                v.double ? "border-zinc-800 bg-zinc-800 text-white" : "border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              ダブル
            </button>
            <button onClick={() => move(i, -1)} className="px-1 text-xs text-zinc-500">
              ▲
            </button>
            <button onClick={() => move(i, 1)} className="px-1 text-xs text-zinc-500">
              ▼
            </button>
            <button
              onClick={() => setVoices((prev) => prev.filter((_, k) => k !== i))}
              className="ml-auto px-1 text-xs text-red-500"
            >
              削除
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          {(Object.keys(MEMBERS) as MemberKey[])
            .filter((m) => !used.has(m))
            .map((m) => (
              <button
                key={m}
                onClick={() => setVoices((prev) => [...prev, { member: m, role: "L", double: false }])}
                className="rounded-full border px-2.5 py-1 text-xs hover:bg-zinc-50"
                style={{ borderColor: MEMBERS[m].color }}
              >
                ＋ {MEMBERS[m].name}
              </button>
            ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input type="radio" checked={scope === "line"} onChange={() => setScope("line")} />
          この行だけ
        </label>
        {sectionLabel && sectionLineCount > 1 && (
          <label className="flex items-center gap-1">
            <input type="radio" checked={scope === "section"} onChange={() => setScope("section")} />
            このセクション全体（{sectionLineCount}行）
          </label>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave(voices, scope)}
          disabled={saving}
          className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        <button
          onClick={() => onReset(scope)}
          disabled={saving}
          className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50"
        >
          初期値に戻す
        </button>
      </div>
    </div>
  );
}
