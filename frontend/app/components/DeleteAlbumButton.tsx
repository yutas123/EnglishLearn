"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteAlbumButton({
  albumId,
  albumTitle,
}: {
  albumId: string;
  albumTitle: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError(false);
    try {
      const res = await fetch(`/api/albums/${albumId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.push("/");
      router.refresh();
    } catch {
      setError(true);
      setDeleting(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-fit text-xs text-zinc-400 hover:text-red-600 hover:underline"
      >
        このアルバムを削除
      </button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label="アルバム削除の確認"
      className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm"
    >
      <p className="text-red-700">
        「{albumTitle}」を本当に削除しますか？ 歌詞・翻訳・解説と、このアルバムの曲から登録した単語も削除され、元に戻せません。
      </p>
      {error && <p className="text-xs text-red-600">削除に失敗しました</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(false);
          }}
          disabled={deleting}
          className="rounded border border-zinc-300 bg-white px-3 py-1 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {deleting ? "削除中…" : "削除する"}
        </button>
      </div>
    </div>
  );
}
