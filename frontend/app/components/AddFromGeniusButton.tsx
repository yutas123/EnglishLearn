"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type AlbumSuggestion = {
  id: number;
  name: string;
  artistName: string;
  coverArtUrl: string | null;
  url: string;
};

type AlbumPreview = AlbumSuggestion & {
  tracks: { trackNo: number; title: string }[];
};

type JobResponse = {
  status: string;
  progressLog: string | null;
  errorMessage: string | null;
  totalTracks: number | null;
  completedTracks: number;
  costUsd: number;
};

type Stage =
  | { step: "search" }
  | { step: "loadingPreview" }
  | { step: "preview"; album: AlbumPreview }
  | { step: "processing" }
  | { step: "done" }
  | { step: "error"; message: string };

function formatCost(costUsd: number) {
  if (!costUsd) return null;
  const yen = costUsd * 150;
  return `💰 現在までの費用: $${costUsd.toFixed(4)}（約${yen.toFixed(1)}円）`;
}

export default function AddFromGeniusButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AlbumSuggestion[]>([]);
  const [stage, setStage] = useState<Stage>({ step: "search" });
  const [progress, setProgress] = useState<{ completed: number; total: number | null } | null>(
    null
  );
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function closeModal() {
    if (pollRef.current) clearInterval(pollRef.current);
    setOpen(false);
    setQuery("");
    setSuggestions([]);
    setStage({ step: "search" });
    setProgress(null);
    setProgressMessage(null);
    setCostUsd(0);
  }

  useEffect(() => {
    if (!open || stage.step !== "search") return;

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/genius/search-albums?q=${encodeURIComponent(trimmed)}`
        );
        const data = await res.json();
        if (currentRequestId !== requestIdRef.current) return; // 古いリクエストの結果は無視
        setSuggestions(data.albums ?? []);
      } catch {
        if (currentRequestId !== requestIdRef.current) return;
        setSuggestions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, open, stage.step]);

  async function handleSelectAlbum(album: AlbumSuggestion) {
    setStage({ step: "loadingPreview" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/genius/albums/${album.id}/preview`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "アルバム情報の取得に失敗しました");
      setStage({ step: "preview", album: data });
    } catch (err) {
      setStage({
        step: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  function pollJob(jobId: string) {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}`);
        const data: JobResponse = await res.json();

        setProgressMessage(data.progressLog);
        setCostUsd(data.costUsd ?? 0);
        if (data.totalTracks) {
          setProgress({ completed: data.completedTracks, total: data.totalTracks });
        }

        if (data.status === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStage({ step: "done" });
          router.refresh();
        } else if (data.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStage({ step: "error", message: data.errorMessage ?? "エラーが発生しました" });
        }
      } catch {
        // 一時的なネットワークエラーはポーリング継続
      }
    }, 2000);
  }

  async function handleConfirmRegister() {
    if (stage.step !== "preview" || !BACKEND_URL) return;
    const { album } = stage;

    setStage({ step: "processing" });
    setProgress(null);
    setProgressMessage("登録処理を開始しています...");
    setCostUsd(0);

    try {
      const res = await fetch(`${BACKEND_URL}/api/jobs/from-genius`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geniusAlbumId: album.id,
          artistName: album.artistName,
          albumName: album.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ジョブの作成に失敗しました");
      pollJob(data.jobId);
    } catch (err) {
      setStage({
        step: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-fit whitespace-nowrap rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        📖 Geniusから追加
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-lg bg-white p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-800">Geniusからアルバムを追加</h2>
              <button
                onClick={closeModal}
                aria-label="閉じる"
                className="text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>

            {stage.step === "search" && (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="アーティスト名・アルバム名で検索"
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-base focus:border-zinc-500 focus:outline-none"
                />
                <ul className="flex flex-col divide-y divide-zinc-100">
                  {suggestions.map((album) => (
                    <li key={album.id}>
                      <button
                        onClick={() => handleSelectAlbum(album)}
                        className="flex w-full items-center gap-3 py-2 text-left hover:bg-zinc-50"
                      >
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-zinc-100">
                          {album.coverArtUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={album.coverArtUrl}
                              alt={album.name}
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-800">
                            {album.name}
                          </p>
                          <p className="truncate text-xs text-zinc-500">{album.artistName}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                  {query.trim().length >= 2 && suggestions.length === 0 && (
                    <li className="py-2 text-xs text-zinc-400">見つかりませんでした</li>
                  )}
                </ul>
              </div>
            )}

            {stage.step === "loadingPreview" && (
              <p className="text-sm text-zinc-500">アルバム情報を取得中...</p>
            )}

            {stage.step === "preview" && (
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded bg-zinc-100">
                    {stage.album.coverArtUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={stage.album.coverArtUrl}
                        alt={stage.album.name}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-zinc-800">{stage.album.name}</p>
                    <p className="break-words text-sm text-zinc-500">{stage.album.artistName}</p>
                    <p className="mt-1 text-xs text-zinc-400">{stage.album.tracks.length}曲</p>
                  </div>
                </div>

                <ol className="flex max-h-52 flex-col divide-y divide-zinc-100 overflow-y-auto rounded border border-zinc-200 text-sm">
                  {stage.album.tracks.map((track) => (
                    <li key={track.trackNo} className="flex gap-2 px-3 py-1.5">
                      <span className="w-6 shrink-0 text-right text-zinc-400">
                        {track.trackNo}
                      </span>
                      <span className="break-words">{track.title}</span>
                    </li>
                  ))}
                </ol>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleConfirmRegister}
                    className="w-fit rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                  >
                    このアルバムを登録する
                  </button>
                  <button
                    onClick={() => setStage({ step: "search" })}
                    className="text-xs text-zinc-500 hover:text-zinc-700"
                  >
                    検索に戻る
                  </button>
                </div>
              </div>
            )}

            {stage.step === "processing" && (
              <div className="flex flex-col gap-2">
                {progress?.total && (
                  <div className="flex flex-col gap-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="h-full rounded-full bg-zinc-900 transition-all"
                        style={{
                          width: `${Math.round((progress.completed / progress.total) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-zinc-500">
                      {progress.completed}/{progress.total} 曲完了
                    </p>
                  </div>
                )}
                {progressMessage && (
                  <p className="break-words text-sm text-zinc-500">{progressMessage}</p>
                )}
                {formatCost(costUsd) && (
                  <p className="text-xs text-zinc-400">{formatCost(costUsd)}</p>
                )}
              </div>
            )}

            {stage.step === "done" && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-emerald-700">
                  🎉 アルバムを登録しました
                </p>
                <button
                  onClick={closeModal}
                  className="w-fit rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium hover:bg-zinc-50"
                >
                  閉じる
                </button>
              </div>
            )}

            {stage.step === "error" && (
              <div className="flex flex-col gap-2">
                <p className="break-words text-sm text-red-600">{stage.message}</p>
                <button
                  onClick={closeModal}
                  className="w-fit rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium hover:bg-zinc-50"
                >
                  閉じる
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
