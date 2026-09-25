"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type JobStatus = "idle" | "pending" | "running" | "done" | "error";

type JobResponse = {
  status: string;
  progressLog: string | null;
  errorMessage: string | null;
  totalTracks: number | null;
  completedTracks: number;
  costUsd: number;
};

function formatCost(costUsd: number) {
  if (!costUsd) return null;
  const yen = costUsd * 150;
  return `💰 現在までの費用: $${costUsd.toFixed(4)}（約${yen.toFixed(1)}円）`;
}

export default function AddCurrentTrackButton() {
  const router = useRouter();
  const [status, setStatus] = useState<JobStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number | null;
  } | null>(null);
  const [costUsd, setCostUsd] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function pollJob(jobId: string) {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}`);
        const data: JobResponse = await res.json();

        setMessage(data.progressLog);
        setCostUsd(data.costUsd ?? 0);
        if (data.totalTracks) {
          setProgress({ completed: data.completedTracks, total: data.totalTracks });
        }

        if (data.status === "done") {
          setStatus("done");
          if (pollRef.current) clearInterval(pollRef.current);
          router.refresh();
        } else if (data.status === "error") {
          setStatus("error");
          setMessage(data.errorMessage ?? "エラーが発生しました");
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setStatus(data.status as JobStatus);
        }
      } catch {
        // 一時的なネットワークエラーはポーリング継続
      }
    }, 2000);
  }

  async function handleClick() {
    if (!BACKEND_URL) {
      setStatus("error");
      setMessage("NEXT_PUBLIC_BACKEND_URL が設定されていません");
      return;
    }

    setStatus("pending");
    setMessage("Spotifyの再生状況を確認中...");
    setProgress(null);
    setCostUsd(0);

    try {
      const res = await fetch(`${BACKEND_URL}/api/jobs/from-spotify`, {
        method: "POST",
      });

      if (res.status === 404) {
        setStatus("error");
        setMessage("再生中の曲がありません");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "ジョブの作成に失敗しました");
      }

      const data = await res.json();
      setMessage(`処理を開始しました: ${data.artistName} - ${data.albumName}`);
      pollJob(data.jobId);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "エラーが発生しました");
    }
  }

  const isBusy = status === "pending" || status === "running";
  const costLine = formatCost(costUsd);

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={isBusy}
        className="w-fit whitespace-nowrap rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isBusy ? "処理中..." : "🎧 今聴いてる曲を追加"}
      </button>

      {isBusy && progress?.total && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-zinc-900 transition-all"
              style={{
                width: `${Math.round(
                  (progress.completed / progress.total) * 100
                )}%`,
              }}
            />
          </div>
          <p className="text-xs text-zinc-500">
            {progress.completed}/{progress.total} 曲完了
          </p>
        </div>
      )}

      {message && (
        <p
          className={`break-words text-sm ${
            status === "error" ? "text-red-600" : "text-zinc-500"
          }`}
        >
          {message}
        </p>
      )}

      {costLine && <p className="text-xs text-zinc-400">{costLine}</p>}
    </div>
  );
}
