"use client";

import { useState } from "react";
import { MEMBERS, roleLabel, type MemberKey, type Voice, type VoicePart } from "@/lib/beatles";

export type VocalScope = "line" | "section";

// 括弧書き "(...)" の前後を分割位置として返す（コーラスは括弧書きのことが多い）
function parenBoundaries(text: string): number[] {
  const result: number[] = [];
  for (const m of text.matchAll(/\([^)]*\)/g)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (s > 0) result.push(s);
    if (e < text.length) result.push(e);
  }
  return result;
}

// 分割位置のリストから、パート構成を作る。歌い手は元のパートのものを引き継ぐ
function rebuildParts(prev: VoicePart[], boundaries: number[], length: number): VoicePart[] {
  const ends = [...new Set(boundaries.filter((b) => b > 0 && b < length)), length].sort((a, b) => a - b);
  let start = 0;
  return ends.map((end) => {
    const source = prev.find((p) => p.end > start) ?? prev[prev.length - 1];
    start = end;
    return { end, voices: source.voices.map((v) => ({ ...v })) };
  });
}

/**
 * 行の下線（誰が歌っているか）を編集する下部シート。
 * 行は「パート」に分けられ（括弧で自動分割／単語の間をタップして手動分割）、パートごとに歌い手を選ぶ。
 * voices は上から順（音程の高い順）。保存範囲は「この行だけ」か「同じ見出しの連続する行すべて」
 * （セクション全体はパートを分けていないときのみ）。
 */
export default function VocalEditor({
  lineText,
  initialParts,
  orderLocked,
  sectionLabel,
  sectionLineCount,
  saving,
  error,
  onSave,
  onReset,
  onClose,
}: {
  lineText: string;
  initialParts: VoicePart[];
  // 曲全体の並び順が設定されている間は、行ごとの並べ替えは効かない
  orderLocked: boolean;
  sectionLabel: string | null;
  sectionLineCount: number;
  saving: boolean;
  error: string | null;
  onSave: (parts: VoicePart[], scope: VocalScope) => void;
  onReset: (scope: VocalScope) => void;
  onClose: () => void;
}) {
  const [parts, setParts] = useState<VoicePart[]>(initialParts);
  const [sel, setSel] = useState(0);
  const [scope, setScope] = useState<VocalScope>("line");

  const split = parts.length > 1;
  const current = parts[Math.min(sel, parts.length - 1)];
  const voices = current.voices;
  const boundaries = parts.slice(0, -1).map((p) => p.end);
  const autoBoundaries = parenBoundaries(lineText);
  const canAutoSplit = autoBoundaries.length > 0 && autoBoundaries.some((b) => !boundaries.includes(b));

  const setVoices = (fn: (prev: Voice[]) => Voice[]) =>
    setParts((prev) => prev.map((p, i) => (i === sel ? { ...p, voices: fn(p.voices) } : p)));
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

  const setBoundaries = (next: number[]) => {
    setParts((prev) => rebuildParts(prev, next, lineText.length));
    setSel(0);
    setScope("line");
  };
  const toggleBoundary = (pos: number) =>
    setBoundaries(boundaries.includes(pos) ? boundaries.filter((b) => b !== pos) : [...boundaries, pos]);

  // 単語の先頭位置（分割位置の候補）
  const words = [...lineText.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index ?? 0 }));
  const partIndexAt = (pos: number) => parts.findIndex((p) => pos < p.end);
  const partRange = (i: number) => [i === 0 ? 0 : parts[i - 1].end, parts[i].end] as const;

  return (
    <div
      data-vocal-editor
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-h-[70vh] w-auto max-w-2xl flex-col gap-3 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words font-medium leading-8">
          {words.map((w, wi) => {
            const pi = partIndexAt(w.start);
            const active = split && pi === sel;
            return (
              <span key={w.start}>
                {wi > 0 && (
                  <button
                    onClick={() => toggleBoundary(w.start)}
                    aria-label="ここで分ける／つなぐ"
                    className={`mx-px inline-block w-3 rounded text-center text-xs ${
                      boundaries.includes(w.start)
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500"
                    }`}
                  >
                    |
                  </button>
                )}
                <span
                  onClick={() => split && setSel(pi)}
                  className={`rounded px-0.5 ${active ? "bg-amber-100" : ""} ${split ? "cursor-pointer" : ""}`}
                >
                  {w.text}
                </span>
              </span>
            );
          })}
        </p>
        <button onClick={onClose} className="shrink-0 text-xs text-zinc-400 hover:text-zinc-600">
          ✕ 閉じる
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-400">単語の間の「|」で部分ごとに分けられます</span>
        {canAutoSplit && (
          <button
            onClick={() => setBoundaries([...boundaries, ...autoBoundaries])}
            className="rounded-full border border-zinc-300 px-2.5 py-1 hover:bg-zinc-50"
          >
            括弧で分ける
          </button>
        )}
        {split && (
          <button
            onClick={() => setBoundaries([])}
            className="rounded-full border border-zinc-300 px-2.5 py-1 hover:bg-zinc-50"
          >
            分割をやめる
          </button>
        )}
      </div>

      {split && (
        <div className="flex flex-col gap-1">
          {parts.map((p, i) => {
            const [a, b] = partRange(i);
            return (
              <button
                key={i}
                onClick={() => setSel(i)}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs ${
                  i === sel ? "border-amber-400 bg-amber-50" : "border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{lineText.slice(a, b).trim()}</span>
                <span className="flex shrink-0 gap-1">
                  {p.voices.length === 0 && <span className="text-zinc-400">線なし</span>}
                  {p.voices.map((v) => (
                    <span
                      key={v.member}
                      className="inline-block h-[3px] w-4 rounded-full"
                      style={{ backgroundColor: v.role === "L" ? MEMBERS[v.member].color : MEMBERS[v.member].color + "99" }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-zinc-400">
          {orderLocked ? "線の並びは「この曲の線の並び」の設定に従います" : "上の線から順に表示（▲▼で並べ替え）"}
        </p>
        {voices.length === 0 && <p className="text-xs text-zinc-500">線なし</p>}
        {voices.map((v, i) => (
          <div key={v.member} className="flex flex-wrap items-center gap-2">
            <span
              className="inline-block h-[3px] w-5 rounded-full"
              style={{ backgroundColor: v.role === "L" ? MEMBERS[v.member].color : MEMBERS[v.member].color + "99" }}
            />
            <span className="w-14 text-xs font-medium">{MEMBERS[v.member].name}</span>
            <button
              onClick={() => update(i, { role: v.role === "L" ? "H" : "L" })}
              className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50"
            >
              {roleLabel(v, voices.length)}
            </button>
            <button
              onClick={() => update(i, { double: !v.double })}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                v.double ? "border-zinc-800 bg-zinc-800 text-white" : "border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              ダブル
            </button>
            {!orderLocked && (
              <>
                <button onClick={() => move(i, -1)} className="px-1 text-xs text-zinc-500">
                  ▲
                </button>
                <button onClick={() => move(i, 1)} className="px-1 text-xs text-zinc-500">
                  ▼
                </button>
              </>
            )}
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
        {sectionLabel && sectionLineCount > 1 && !split && (
          <label className="flex items-center gap-1">
            <input type="radio" checked={scope === "section"} onChange={() => setScope("section")} />
            このセクション全体（{sectionLineCount}行）
          </label>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave(parts, scope)}
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
