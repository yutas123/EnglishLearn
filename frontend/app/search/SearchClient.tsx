"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Result = {
  trackId: string;
  trackTitle: string;
  albumTitle: string;
  artistName: string;
  lineIndex: number;
  original: string;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, query: string) {
  const q = query.trim().replace(/\s+/g, " ");
  if (!q) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "i"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="rounded bg-amber-100 px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export default function SearchClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setTruncated(false);
      setError(null);
      setSearchedQuery("");
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("検索に失敗しました");
        const data = await res.json();
        setResults(data.results);
        setTruncated(data.truncated);
        setSearchedQuery(trimmed);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "エラーが発生しました");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  return (
    <div className="flex flex-col gap-4">
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value.replace(/\n/g, " "))}
        placeholder="歌詞の中から単語・熟語を検索（2文字以上）"
        rows={2}
        autoFocus
        className="w-full resize-none rounded-lg border border-zinc-300 p-3 text-sm outline-none focus:border-zinc-500"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-xs text-zinc-400">検索中...</p>}

      {!loading && searchedQuery && !error && (
        <p className="text-xs text-zinc-500">
          {results.length === 0
            ? "該当する歌詞が見つかりませんでした"
            : `${truncated ? `${results.length}件以上` : `${results.length}件`}見つかりました${
                truncated ? "（先頭のみ表示。語句を絞り込んでください）" : ""
              }`}
        </p>
      )}

      <ul className="flex flex-col divide-y divide-zinc-100">
        {results.map((r) => (
          <li key={`${r.trackId}-${r.lineIndex}`}>
            <Link
              href={`/tracks/${r.trackId}#line-${r.lineIndex}`}
              className="flex flex-col gap-0.5 py-3 hover:bg-zinc-50"
            >
              <span className="break-words text-sm font-medium leading-relaxed">
                {highlight(r.original, searchedQuery)}
              </span>
              <span className="truncate text-xs text-zinc-500">
                {r.trackTitle} ・ {r.artistName} ・ {r.albumTitle}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
