"use client";

import type { KnownSpan } from "@/lib/vocabMatcher";

// 登録済み語のクリックは、状態を持つ LyricsList 側のポップアップで処理するため、
// window のカスタムイベントで伝える（歌詞行のクリックと同じ処理に合流させる）。
export const KNOWN_TITLE_CLICK_EVENT = "vocab-title-known-click";

export type KnownTitleClickDetail = { span: KnownSpan; text: string; rect: DOMRect };

/**
 * 曲タイトル。歌詞と同じようにドラッグ選択で語彙登録でき（data-line-index="-1"）、
 * 登録済みの語には緑のマーカーを付ける。
 */
export default function TrackTitle({ title, spans }: { title: string; spans: KnownSpan[] }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // 重なるスパンはスキップ
    if (span.start > cursor) parts.push(title.slice(cursor, span.start));
    const text = title.slice(span.start, span.end);
    parts.push(
      <mark
        key={span.start}
        className="cursor-pointer rounded bg-emerald-100 px-0.5 text-inherit hover:bg-emerald-200"
        title="登録済み（タップで詳細）"
        onClick={(e) => {
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent<KnownTitleClickDetail>(KNOWN_TITLE_CLICK_EVENT, {
              detail: { span, text, rect: e.currentTarget.getBoundingClientRect() },
            })
          );
        }}
      >
        {text}
      </mark>
    );
    cursor = span.end;
  }
  if (cursor < title.length) parts.push(title.slice(cursor));

  return (
    <h1 data-line-index="-1" data-original={title} className="break-words text-xl font-bold">
      {parts}
    </h1>
  );
}
