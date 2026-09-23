"use client";

import Link from "next/link";
import { useState } from "react";

type Occurrence = {
  trackId: string;
  trackTitle: string;
  albumTitle: string;
  lineIndex: number;
};

export default function OccurrencesPanel({
  vocabEntryId,
  count,
}: {
  vocabEntryId: string;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const [occurrences, setOccurrences] = useState<Occurrence[] | null>(null);
  const [loading, setLoading] = useState(false);

  if (count <= 1) return null;

  async function handleToggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (occurrences) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/vocab/${vocabEntryId}/occurrences`);
      const data = await res.json();
      setOccurrences(data.occurrences ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-1">
      <button
        onClick={handleToggle}
        className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline"
      >
        他{count - 1}箇所でも登場 {open ? "▲" : "▼"}
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1 border-l border-zinc-200 pl-2 text-xs text-zinc-500">
          {loading && <li>読み込み中...</li>}
          {occurrences?.map((o, i) => (
            <li key={i}>
              <Link href={`/tracks/${o.trackId}`} className="hover:underline">
                {o.albumTitle} - {o.trackTitle}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
