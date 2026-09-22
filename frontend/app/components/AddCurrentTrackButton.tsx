"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type JobStatus = "idle" | "pending" | "running" | "done" | "error";

type JobResponse = {
  status: string;
  progressLog: string | null;
  errorMessage: string | null;
};

export default function AddCurrentTrackButton() {
  const router = useRouter();
  const [status, setStatus] = useState<JobStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
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

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={isBusy}
        className="w-fit rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isBusy ? "処理中..." : "🎧 今聴いてる曲を追加"}
      </button>
      {message && (
        <p
          className={`text-sm ${
            status === "error" ? "text-red-600" : "text-zinc-500"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
