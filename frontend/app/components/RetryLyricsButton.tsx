"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function RetryLyricsButton({ trackId }: { trackId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    if (!BACKEND_URL || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/tracks/${trackId}/retry-lyrics`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "歌詞の取得に失敗しました");
        return;
      }
      router.refresh();
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-zinc-500">歌詞データがありません。</p>
      <button
        onClick={retry}
        disabled={loading}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {loading ? "歌詞を取得中...（1分ほどかかります）" : "🔄 歌詞を再取得する"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
