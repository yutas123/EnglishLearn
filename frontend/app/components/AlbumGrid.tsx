"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";

type Album = {
  id: string;
  artistName: string;
  albumTitle: string;
  coverArtUrl: string | null;
  trackCount: number;
};

export default function AlbumGrid({ albums }: { albums: Album[] }) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const keyword = query.trim().toLowerCase();
  const isFiltering = keyword.length > 0;

  // albumsは追加日の新しい順で渡されるため、アーティストの並びも「最近追加したアーティスト順」になる
  const groups = useMemo(() => {
    const filtered = keyword
      ? albums.filter(
          (a) =>
            a.albumTitle.toLowerCase().includes(keyword) ||
            a.artistName.toLowerCase().includes(keyword)
        )
      : albums;
    const map = new Map<string, Album[]>();
    for (const a of filtered) {
      const list = map.get(a.artistName) ?? [];
      list.push(a);
      map.set(a.artistName, list);
    }
    return [...map.entries()];
  }, [albums, keyword]);

  function toggle(artist: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(artist)) next.delete(artist);
      else next.add(artist);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アルバム名・アーティスト名で絞り込み"
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
      />

      {groups.length === 0 && (
        <p className="text-sm text-zinc-500">該当するアルバムがありません。</p>
      )}

      {groups.map(([artist, list]) => {
        // 絞り込み中は折りたたみ状態を無視して、該当アルバムをすべて見せる
        const isOpen = isFiltering || !collapsed.has(artist);
        return (
          <section key={artist} className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => toggle(artist)}
              aria-expanded={isOpen}
              className="flex items-center gap-2 text-left"
            >
              <span className="w-3 text-xs text-zinc-400">{isOpen ? "▼" : "▶"}</span>
              <span className="truncate text-sm font-semibold text-zinc-800">{artist}</span>
              <span className="shrink-0 text-xs text-zinc-400">{list.length}枚</span>
            </button>

            {isOpen && (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {list.map((album) => (
                  <li key={album.id}>
                    <Link
                      href={`/albums/${album.id}`}
                      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 transition hover:border-zinc-400"
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded bg-zinc-100">
                        {album.coverArtUrl ? (
                          <Image
                            src={album.coverArtUrl}
                            alt={album.albumTitle}
                            fill
                            sizes="200px"
                            className="object-cover"
                          />
                        ) : null}
                      </div>
                      <div>
                        <p className="truncate text-sm font-medium">{album.albumTitle}</p>
                        <p className="truncate text-xs text-zinc-500">{album.trackCount}曲</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
