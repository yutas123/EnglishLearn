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
};

function normalize(s: string) {
  return s.toLowerCase().trim();
}

export default function SpotifyRemote({ trackId, title, artistName }: Props) {
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
    <button
      onClick={handleToggle}
      disabled={busy}
      aria-label={isThisTrackPlaying ? "一時停止" : "この曲を再生"}
      title={error ?? (isThisTrackPlaying ? "一時停止" : "この曲を再生")}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-base hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 ${
        error ? "border-red-300" : "border-zinc-300"
      }`}
    >
      {isThisTrackPlaying ? "⏸" : "▶️"}
      {error && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
      )}
    </button>
  );
}
