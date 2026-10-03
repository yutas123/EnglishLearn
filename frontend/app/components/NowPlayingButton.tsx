"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type Match = {
  trackId: string;
  title: string;
  artistName: string;
  albumArtUrl: string | null;
} | null;

export default function NowPlayingButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [match, setMatch] = useState<Match>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function fetchMatch() {
      if (!BACKEND_URL) return;
      try {
        const res = await fetch(`${BACKEND_URL}/api/spotify/now-playing-match`);
        const data = await res.json();
        setMatch(data.trackId ? data : null);
      } catch {
        // 一時的なネットワークエラーはポーリング継続
      }
    }

    fetchMatch();
    pollRef.current = setInterval(fetchMatch, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // その曲のページを見ている間も表示し続ける（歌詞を見ながらタイトルを確認できるように）
  const alreadyThere = !!pathname?.startsWith(`/tracks/${match?.trackId}`);

  if (!match) return null;

  return (
    <button
      onClick={() => {
        if (!alreadyThere) router.push(`/tracks/${match.trackId}`);
      }}
      className={
        alreadyThere
          ? // 再生中の曲のページを見ている間は、画面上部中央に表示
            "fixed left-1/2 top-2 z-40 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-200 bg-white px-2 py-1 text-left shadow-lg hover:bg-zinc-50"
          : // 別のページからその曲へジャンプするボタンは、右下に表示
            "fixed bottom-4 right-4 z-40 flex max-w-[16rem] items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-left shadow-lg hover:bg-zinc-50"
      }
    >
      {match.albumArtUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={match.albumArtUrl}
          alt=""
          className="h-7 w-7 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-7 w-7 shrink-0 rounded bg-zinc-100" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-zinc-800">
          🎧 {match.title}
        </span>
        <span className="block truncate text-[11px] text-zinc-500">
          {alreadyThere ? `${match.artistName} · 再生中` : `${match.artistName} を開く`}
        </span>
      </span>
    </button>
  );
}
