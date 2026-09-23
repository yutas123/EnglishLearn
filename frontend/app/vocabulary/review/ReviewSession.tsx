"use client";

import Link from "next/link";
import { useState } from "react";

type Card = {
  id: string;
  term: string;
  meaning: string;
  partOfSpeech: string | null;
  cefr: string | null;
};

export default function ReviewSession({ cards }: { cards: Card[] }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (cards.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        今日復習すべき語彙はありません。すべて消化済みです 🎉
      </p>
    );
  }

  if (index >= cards.length) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-600">お疲れさまでした！{cards.length}語を復習しました。</p>
        <Link href="/vocabulary" className="w-fit text-sm text-zinc-500 hover:underline">
          ← 単語帳に戻る
        </Link>
      </div>
    );
  }

  const card = cards[index];

  async function handleRate(quality: "again" | "good" | "easy") {
    setSubmitting(true);
    try {
      await fetch(`/api/vocab/${card.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality }),
      });
    } finally {
      setSubmitting(false);
      setRevealed(false);
      setIndex((i) => i + 1);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-zinc-400">
        {index + 1} / {cards.length}
      </p>

      <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-zinc-200 p-8 text-center">
        <p className="text-2xl font-bold">{card.term}</p>
        {revealed ? (
          <div className="flex flex-col items-center gap-1">
            {card.partOfSpeech && (
              <span className="text-xs text-zinc-400">
                [{card.partOfSpeech}] {card.cefr ? `(${card.cefr})` : ""}
              </span>
            )}
            <p className="text-zinc-700">{card.meaning}</p>
          </div>
        ) : (
          <button
            onClick={() => setRevealed(true)}
            className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm hover:bg-zinc-50"
          >
            意味を見る
          </button>
        )}
      </div>

      {revealed && (
        <div className="flex gap-2">
          <button
            disabled={submitting}
            onClick={() => handleRate("again")}
            className="flex-1 rounded-full bg-red-50 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            もう一度
          </button>
          <button
            disabled={submitting}
            onClick={() => handleRate("good")}
            className="flex-1 rounded-full bg-zinc-100 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
          >
            普通
          </button>
          <button
            disabled={submitting}
            onClick={() => handleRate("easy")}
            className="flex-1 rounded-full bg-emerald-50 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            簡単
          </button>
        </div>
      )}
    </div>
  );
}
