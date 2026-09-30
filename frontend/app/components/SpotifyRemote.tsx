"use client";

import { useEffect, useRef, useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type PlaybackState = {
  isPlaying: boolean;
  trackName: string | null;
  artistName: string | null;
};

type Props = {
  trackId: string;
  title: string;
  artistName: string;
  albumArtUrl: string | null;
};

function normalize(s: string) {
  return s.toLowerCase().trim();
}

export default function SpotifyRemote({
  trackId,
  title,
  artistName,
  albumArtUrl,
}: Props) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  const isThisTrackActive =
    !!state &&
    normalize(state.trackName ?? "") === normalize(title) &&
    normalize(state.artistName ?? "") === normalize(artistName);
  const isThisTrackPlaying = isThisTrackActive && state!.isPlaying;

  async function callApi(path: string, body?: Record<string, unknown>) {
    if (!BACKEND_URL) return;
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "操作に失敗しました");
    }
  }

  async function handleToggle() {
    if (!BACKEND_URL || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isThisTrackPlaying) {
        await callApi("/api/spotify/pause");
      } else if (isThisTrackActive) {
        // 既にこの曲が読み込まれている（一時停止中）ので、検索し直さずそのまま再開
        await callApi("/api/spotify/play");
      } else {
        await callApi("/api/spotify/play-track", { trackId });
      }
      // Spotify Connect側への反映に少しラグがあるため、間を置いて状態を取り直す
      setTimeout(fetchState, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2">
      {albumArtUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={albumArtUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded bg-zinc-100" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-zinc-500">{artistName}</p>
      </div>

      <button
        onClick={handleToggle}
        disabled={busy}
        aria-label={isThisTrackPlaying ? "一時停止" : "この曲を再生"}
        className="shrink-0 rounded-full p-2 text-lg hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isThisTrackPlaying ? "⏸" : "▶️"}
      </button>

      {error && (
        <p
          className="max-w-[10rem] shrink-0 truncate text-xs text-red-600"
          title={error}
        >
          {error}
        </p>
      )}
    </div>
  );
}
