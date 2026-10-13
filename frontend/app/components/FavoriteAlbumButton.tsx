"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FavoriteAlbumButton({
  albumId,
  initialIsFavorite,
}: {
  albumId: string;
  initialIsFavorite: boolean;
}) {
  const router = useRouter();
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    if (saving) return;
    const next = !isFavorite;
    setIsFavorite(next); // 先に見た目を切り替え、失敗したら戻す
    setSaving(true);
    setError(false);
    try {
      const res = await fetch(`/api/albums/${albumId}/favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: next }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setIsFavorite(!next);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">保存に失敗しました</span>}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? "お気に入りから外す" : "お気に入りに追加"}
        title={isFavorite ? "お気に入りから外す" : "お気に入りに追加（一覧の上部に固定）"}
        className={`flex h-9 w-9 items-center justify-center rounded-full border text-lg transition ${
          isFavorite
            ? "border-amber-300 bg-amber-50 text-amber-500"
            : "border-zinc-300 text-zinc-300 hover:text-amber-400"
        }`}
      >
        {isFavorite ? "★" : "☆"}
      </button>
    </div>
  );
}
