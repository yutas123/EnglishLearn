"use client";

import { useEffect, useRef, useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type PlaybackState = {
  isPlaying: boolean;
  trackName: string | null;
  artistName: string | null;
  albumArtUrl: string | null;
};

type Action = "play" | "pause" | "next" | "previous";

export default function SpotifyRemote() {
  const [state, setState] = useState<PlaybackState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchState() {
    if (!BACKEND_URL) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/spotify/state`);
      const data: PlaybackState = await res.json();
      setState(data);
    } catch {
      // ポーリング中の一時的なネットワークエラーは無視
    }
  }

  useEffect(() => {
    fetchState();
    pollRef.current = setInterval(fetchState, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleAction(action: Action) {
    if (!BACKEND_URL || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/spotify/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "操作に失敗しました");
      }
      // Spotify Connect側への反映に少しラグがあるため、間を置いて状態を取り直す
      setTimeout(fetchState, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2">
      {state.albumArtUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={state.albumArtUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded bg-zinc-100" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {state.trackName ?? "再生中の曲がありません"}
        </p>
        {state.artistName && (
          <p className="truncate text-xs text-zinc-500">{state.artistName}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => handleAction("previous")}
          disabled={busy}
          aria-label="前の曲"
          className="rounded-full p-2 text-lg hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ⏮
        </button>
        <button
          onClick={() => handleAction(state.isPlaying ? "pause" : "play")}
          disabled={busy}
          aria-label={state.isPlaying ? "一時停止" : "再生"}
          className="rounded-full p-2 text-lg hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.isPlaying ? "⏸" : "▶️"}
        </button>
        <button
          onClick={() => handleAction("next")}
          disabled={busy}
          aria-label="次の曲"
          className="rounded-full p-2 text-lg hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ⏭
        </button>
      </div>

      {error && (
        <p className="max-w-[10rem] shrink-0 truncate text-xs text-red-600" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
