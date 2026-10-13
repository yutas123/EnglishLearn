"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

/**
 * コアイメージ帳の語ごとのイラスト表示。
 * 保存直後はバックグラウンドで生成中のことがあるため、未生成なら「生成」ボタンを出す。
 */
export default function CoreIllustration({
  entryId,
  term,
  version,
}: {
  entryId: string;
  term: string;
  version: number | null;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!BACKEND_URL) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/core-image/${entryId}/illustration`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "イラストの生成に失敗しました");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {version && BACKEND_URL && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${BACKEND_URL}/api/core-image/${entryId}/illustration?v=${version}`}
          alt={`${term} のイメージ`}
          loading="lazy"
          className="w-full max-w-xs rounded-lg border border-zinc-100"
        />
      )}
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="w-fit rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50"
      >
        {generating ? "生成中...（10秒ほど）" : version ? "🎨 描き直す" : "🎨 イラストを生成"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
