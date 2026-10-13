"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

const MAX_SELECT = 10; // バックエンドの上限(BULK_MAX_ALBUMS)と揃える
const RESOLVE_CONCURRENCY = 2;
const COST_PER_ALBUM_USD = 0.14; // 完了済みジョブの実績平均（約10曲/枚）
const YEN_PER_USD = 150;

type GeniusAlbum = {
  id: number;
  name: string;
  artistName: string;
  coverArtUrl: string | null;
  tracks: { trackNo: number; title: string }[];
};

type Item = {
  mbid: string;
  title: string;
  releaseDate: string | null;
  // registered: 登録済み / resolving: Genius照合待ち・中 / ready: 登録可能 / notFound: Geniusに無い / error: 照合失敗
  status: "registered" | "resolving" | "ready" | "notFound" | "error";
  genius?: GeniusAlbum;
  checked: boolean;
};

type JobState = {
  jobId: string;
  albumName: string;
  status: string;
  progressLog: string | null;
  completedTracks: number;
  totalTracks: number | null;
  costUsd: number;
  errorMessage: string | null;
};

type Stage =
  | { step: "input" }
  | { step: "loadingList" }
  | { step: "list"; artistName: string }
  | { step: "processing"; skipped: string[] }
  | { step: "done"; skipped: string[] }
  | { step: "error"; message: string };

function formatCost(costUsd: number) {
  return `$${costUsd.toFixed(2)}（約${Math.round(costUsd * YEN_PER_USD)}円）`;
}

export default function BulkAddButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [artistInput, setArtistInput] = useState("");
  const [stage, setStage] = useState<Stage>({ step: "input" });
  const [items, setItems] = useState<Item[]>([]);
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef(0); // モーダルを閉じた/やり直した後に古い照合結果を反映しないための世代番号

  useEffect(() => {
    return () => {
      runIdRef.current++;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function closeModal() {
    runIdRef.current++;
    if (pollRef.current) clearInterval(pollRef.current);
    setOpen(false);
    setArtistInput("");
    setStage({ step: "input" });
    setItems([]);
    setJobs([]);
    setExpanded(new Set());
  }

  function patchItem(mbid: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.mbid === mbid ? { ...it, ...patch } : it)));
  }

  /** MusicBrainzの1枚に対応するGeniusアルバムを探して反映する */
  async function resolveItem(artistName: string, item: Item, runId: number) {
    patchItem(item.mbid, { status: "resolving" });
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/bulk/resolve?artist=${encodeURIComponent(artistName)}&title=${encodeURIComponent(item.title)}`
      );
      const data = await res.json();
      if (runId !== runIdRef.current) return;
      if (!res.ok) throw new Error(data.error);

      if (!data.genius) {
        patchItem(item.mbid, { status: "notFound", checked: false });
      } else if (data.registered) {
        patchItem(item.mbid, { status: "registered", genius: data.genius, checked: false });
      } else {
        // 先に解決できたものから上限まで自動でチェックを入れる
        setItems((prev) => {
          const checkedCount = prev.filter((it) => it.checked).length;
          return prev.map((it) =>
            it.mbid === item.mbid
              ? { ...it, status: "ready", genius: data.genius, checked: checkedCount < MAX_SELECT }
              : it
          );
        });
      }
    } catch {
      if (runId !== runIdRef.current) return;
      patchItem(item.mbid, { status: "error", checked: false });
    }
  }

  async function resolveAll(artistName: string, targets: Item[], runId: number) {
    const queue = [...targets];
    const workers = Array.from({ length: RESOLVE_CONCURRENCY }, async () => {
      while (queue.length > 0 && runId === runIdRef.current) {
        const next = queue.shift()!;
        await resolveItem(artistName, next, runId);
      }
    });
    await Promise.all(workers);
  }

  async function handleSearch() {
    const artist = artistInput.trim();
    if (!artist || !BACKEND_URL) return;
    const runId = ++runIdRef.current;
    setStage({ step: "loadingList" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/bulk/artist-albums?artist=${encodeURIComponent(artist)}`);
      const data = await res.json();
      if (runId !== runIdRef.current) return;
      if (!res.ok) throw new Error(data.error ?? "アルバム一覧の取得に失敗しました");

      const list: Item[] = data.albums.map(
        (a: { mbid: string; title: string; releaseDate: string | null; registered: boolean }) => ({
          mbid: a.mbid,
          title: a.title,
          releaseDate: a.releaseDate,
          status: a.registered ? "registered" : "resolving",
          checked: false,
        })
      );
      if (list.length === 0) throw new Error("公式スタジオアルバムが見つかりませんでした");

      setItems(list);
      setStage({ step: "list", artistName: data.artistName });
      // 登録済みはGenius照合しない(ZenRowsクレジットの節約)
      void resolveAll(data.artistName, list.filter((it) => it.status === "resolving"), runId);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setStage({ step: "error", message: err instanceof Error ? err.message : "エラーが発生しました" });
    }
  }

  function toggleChecked(mbid: string) {
    setItems((prev) => {
      const checkedCount = prev.filter((it) => it.checked).length;
      return prev.map((it) => {
        if (it.mbid !== mbid || it.status !== "ready") return it;
        if (!it.checked && checkedCount >= MAX_SELECT) return it;
        return { ...it, checked: !it.checked };
      });
    });
  }

  function toggleExpanded(mbid: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(mbid)) next.delete(mbid);
      else next.add(mbid);
      return next;
    });
  }

  function pollJobs(initial: JobState[], skipped: string[]) {
    setJobs(initial);
    pollRef.current = setInterval(async () => {
      const latest = await Promise.all(
        initial.map(async (j) => {
          try {
            const res = await fetch(`${BACKEND_URL}/api/jobs/${j.jobId}`);
            const data = await res.json();
            return { ...j, ...data } as JobState;
          } catch {
            return null; // 一時的なエラーは前回の状態を維持
          }
        })
      );
      setJobs((prev) => prev.map((p, i) => latest[i] ?? p));
      const merged = latest.map((l, i) => l ?? initial[i]);
      if (merged.every((j) => j.status === "done" || j.status === "error")) {
        if (pollRef.current) clearInterval(pollRef.current);
        setStage({ step: "done", skipped });
        router.refresh();
      }
    }, 3000);
  }

  async function handleRegister() {
    const selected = items.filter((it) => it.checked && it.genius);
    if (selected.length === 0 || !BACKEND_URL) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/jobs/bulk-from-genius`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          albums: selected.map((it) => ({
            geniusAlbumId: it.genius!.id,
            artistName: it.genius!.artistName,
            albumName: it.genius!.name,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録の開始に失敗しました");

      const skipped: string[] = (data.skipped ?? []).map((s: { albumName: string }) => s.albumName);
      if (data.jobs.length === 0) {
        setStage({ step: "done", skipped });
        return;
      }
      setStage({ step: "processing", skipped });
      pollJobs(
        data.jobs.map((j: { jobId: string; albumName: string }) => ({
          jobId: j.jobId,
          albumName: j.albumName,
          status: "pending",
          progressLog: null,
          completedTracks: 0,
          totalTracks: null,
          costUsd: 0,
          errorMessage: null,
        })),
        skipped
      );
    } catch (err) {
      setStage({ step: "error", message: err instanceof Error ? err.message : "エラーが発生しました" });
    }
  }

  const selectedCount = items.filter((it) => it.checked).length;
  const resolvingCount = items.filter((it) => it.status === "resolving").length;
  const totalCost = jobs.reduce((sum, j) => sum + (j.costUsd ?? 0), 0);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-fit whitespace-nowrap rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        📚 まとめて登録
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && stage.step !== "processing") closeModal();
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-800">
                {stage.step === "list" ? `${stage.artistName} の公式スタジオアルバム` : "アーティストのアルバムをまとめて登録"}
              </h2>
              <button onClick={closeModal} aria-label="閉じる" className="text-zinc-400 hover:text-zinc-600">
                ✕
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
              {stage.step === "input" && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSearch();
                  }}
                >
                  <input
                    type="text"
                    autoFocus
                    value={artistInput}
                    onChange={(e) => setArtistInput(e.target.value)}
                    placeholder="アーティスト名（例: Radiohead）"
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-base focus:border-zinc-500 focus:outline-none"
                  />
                  <p className="text-xs text-zinc-400">
                    公式スタジオアルバム（ライブ盤・ベスト盤などは除く）を一覧表示します。内容を確認してから登録できます。
                  </p>
                  <button
                    type="submit"
                    disabled={!artistInput.trim()}
                    className="w-fit rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
                  >
                    アルバムを探す
                  </button>
                </form>
              )}

              {stage.step === "loadingList" && <p className="text-sm text-zinc-500">アルバム一覧を取得中...</p>}

              {stage.step === "list" && (
                <ul className="flex flex-col divide-y divide-zinc-100">
                  {items.map((it) => {
                    const selectable = it.status === "ready";
                    const disabledByLimit = selectable && !it.checked && selectedCount >= MAX_SELECT;
                    return (
                      <li key={it.mbid} className="py-2">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={it.checked}
                            disabled={!selectable || disabledByLimit}
                            onChange={() => toggleChecked(it.mbid)}
                            aria-label={`${it.title} を登録する`}
                            className="h-4 w-4 shrink-0"
                          />
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-zinc-100">
                            {it.genius?.coverArtUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={it.genius.coverArtUrl} alt={it.title} className="h-full w-full object-cover" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-sm font-medium ${selectable ? "text-zinc-800" : "text-zinc-400"}`}>
                              {it.title}
                            </p>
                            <p className="truncate text-xs text-zinc-500">
                              {it.releaseDate?.slice(0, 4) ?? "年不明"}
                              {it.genius ? ` · ${it.genius.tracks.length}曲` : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-xs">
                            {it.status === "registered" && <span className="text-zinc-400">登録済み</span>}
                            {it.status === "resolving" && <span className="text-zinc-400">照合中…</span>}
                            {it.status === "notFound" && <span className="text-amber-600">Geniusに見つかりません</span>}
                            {it.status === "error" && (
                              <button
                                onClick={() => resolveAll(stage.artistName, [it], runIdRef.current)}
                                className="text-red-600 hover:underline"
                              >
                                照合に失敗・再試行
                              </button>
                            )}
                            {it.genius && it.status === "ready" && (
                              <button
                                onClick={() => toggleExpanded(it.mbid)}
                                className="text-zinc-500 hover:text-zinc-800"
                              >
                                {expanded.has(it.mbid) ? "曲目を閉じる" : "曲目を見る"}
                              </button>
                            )}
                          </div>
                        </div>
                        {expanded.has(it.mbid) && it.genius && (
                          <ol className="ml-7 mt-2 flex flex-col divide-y divide-zinc-100 rounded border border-zinc-200 text-sm">
                            {it.genius.tracks.map((t) => (
                              <li key={t.trackNo} className="flex gap-2 px-3 py-1">
                                <span className="w-6 shrink-0 text-right text-zinc-400">{t.trackNo}</span>
                                <span className="break-words">{t.title}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {(stage.step === "processing" || stage.step === "done") && (
                <div className="flex flex-col gap-3">
                  {stage.step === "done" && (
                    <p className="text-sm font-medium text-emerald-700">🎉 登録処理が完了しました</p>
                  )}
                  {stage.skipped.length > 0 && (
                    <p className="text-xs text-zinc-500">登録済みのためスキップ: {stage.skipped.join("、")}</p>
                  )}
                  <ul className="flex flex-col divide-y divide-zinc-100">
                    {jobs.map((j) => (
                      <li key={j.jobId} className="flex flex-col gap-1 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-zinc-800">{j.albumName}</span>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {j.status === "done" && "✅ 完了"}
                            {j.status === "error" && "❌ エラー"}
                            {j.status === "pending" && "待機中"}
                            {j.status === "running" &&
                              (j.totalTracks ? `${j.completedTracks}/${j.totalTracks} 曲` : "処理中")}
                          </span>
                        </div>
                        {j.status === "running" && j.totalTracks && (
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                            <div
                              className="h-full rounded-full bg-zinc-900 transition-all"
                              style={{ width: `${Math.round((j.completedTracks / j.totalTracks) * 100)}%` }}
                            />
                          </div>
                        )}
                        {j.status === "error" && (
                          <p className="break-words text-xs text-red-600">{j.errorMessage}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                  {totalCost > 0 && <p className="text-xs text-zinc-400">💰 現在までの費用: {formatCost(totalCost)}</p>}
                  {stage.step === "processing" && (
                    <p className="text-xs text-zinc-400">
                      アルバムは1枚ずつ順番に処理します。この画面を閉じても、登録処理は続きます。
                    </p>
                  )}
                </div>
              )}

              {stage.step === "error" && <p className="break-words text-sm text-red-600">{stage.message}</p>}
            </div>

            {stage.step === "list" && (
              <div className="flex flex-col gap-2 border-t border-zinc-100 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-zinc-500">
                    {selectedCount}枚を選択中（最大{MAX_SELECT}枚）
                    {resolvingCount > 0 ? ` · 照合中 ${resolvingCount}枚` : ""}
                    {selectedCount > 0 ? ` · 概算費用 ${formatCost(selectedCount * COST_PER_ALBUM_USD)}` : ""}
                  </p>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => {
                        runIdRef.current++;
                        setItems([]);
                        setStage({ step: "input" });
                      }}
                      className="text-xs text-zinc-500 hover:text-zinc-700"
                    >
                      やり直す
                    </button>
                    <button
                      onClick={handleRegister}
                      disabled={selectedCount === 0}
                      className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
                    >
                      選択した{selectedCount}枚を登録する
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(stage.step === "done" || stage.step === "error") && (
              <div className="border-t border-zinc-100 px-4 py-3">
                <button
                  onClick={closeModal}
                  className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium hover:bg-zinc-50"
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
