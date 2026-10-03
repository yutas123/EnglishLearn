"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SEEK_SECONDS = 5;

// YouTube IFrame Player API のうち、ここで使う分だけの型
type YTPlayer = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(videoId: string): void;
  destroy(): void;
};

type YTNamespace = {
  Player: new (
    host: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    }
  ) => YTPlayer;
  PlayerState: { PLAYING: number };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTubeの読み込みに失敗しました"));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

/** YouTubeのURL（watch / youtu.be / embed / shorts）または動画IDそのものから動画IDを取り出す */
function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.slice(1).slice(0, 11) || null;
    if (host.endsWith("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      const m = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // URLとして解釈できなければ null を返す
  }
  return null;
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function YouTubeSeeker({ trackId }: { trackId: string }) {
  const storageKey = `dictation-youtube:${trackId}`;
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 動画URLはこのブラウザにだけ保持する（消えても再入力すればよい便宜機能）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setVideoId(saved);
    } catch {
      // localStorage が使えない環境では保存なしで動作する
    }
  }, [storageKey]);

  // プレーヤーの生成。動画が変わったら同じプレーヤーで読み込み直す
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    setError(null);

    if (playerRef.current) {
      playerRef.current.loadVideoById(videoId);
      return;
    }

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !containerRef.current || playerRef.current) return;
        const host = document.createElement("div");
        containerRef.current.appendChild(host);
        playerRef.current = new YT.Player(host, {
          videoId,
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onError: (e) => {
              // 101 / 150: 動画の持ち主が埋め込み再生を許可していない
              setError(
                e.data === 101 || e.data === 150
                  ? "この動画は埋め込み再生が許可されていません。別の動画（アップロード版など）のURLを試してください。"
                  : "動画を再生できませんでした。URLを確認してください。"
              );
            },
          },
        });
      })
      .catch((err: Error) => setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // 画面を離れるときにプレーヤーを破棄する
  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  // 再生位置の表示を更新する
  useEffect(() => {
    if (!videoId) return;
    const timer = setInterval(() => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentTime === "function") setTime(p.getCurrentTime());
    }, 500);
    return () => clearInterval(timer);
  }, [videoId]);

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 800);
  }, []);

  const seek = useCallback(
    (delta: number) => {
      const p = playerRef.current;
      if (!p || typeof p.seekTo !== "function") return;
      const next = Math.max(0, p.getCurrentTime() + delta);
      p.seekTo(next, true);
      setTime(next);
      showFlash(delta < 0 ? `⏪ ${-delta}秒戻す` : `⏩ ${delta}秒進める`);
    },
    [showFlash]
  );

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p || typeof p.getPlayerState !== "function") return;
    // 1 = 再生中
    if (p.getPlayerState() === 1) p.pauseVideo();
    else p.playVideo();
  }, []);

  // Alt + ←/→/↓ で操作する。矢印キー単体は入力欄のカーソル移動に使われるため、修飾キーを付ける
  useEffect(() => {
    if (!videoId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(-SEEK_SECONDS);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(SEEK_SECONDS);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        togglePlay();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [videoId, seek, togglePlay]);

  function handleSetUrl() {
    const id = parseVideoId(urlInput);
    if (!id) {
      setError("YouTubeのURLを入力してください（例: https://www.youtube.com/watch?v=…）");
      return;
    }
    setError(null);
    setVideoId(id);
    setUrlInput("");
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // 保存できなくても再生は続けられる
    }
  }

  function handleClear() {
    playerRef.current?.destroy();
    playerRef.current = null;
    if (containerRef.current) containerRef.current.innerHTML = "";
    setVideoId(null);
    setError(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 同上
    }
  }

  return (
    <section className="sticky top-2 z-30 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white/95 p-2 shadow-sm backdrop-blur">
      {!videoId ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs leading-relaxed text-zinc-500">
            YouTubeのURLを入れると、この画面の中で再生できます。入力欄で文字を打ちながら、
            <kbd className="rounded bg-zinc-100 px-1">Alt</kbd> + <kbd className="rounded bg-zinc-100 px-1">←</kbd>
            で{SEEK_SECONDS}秒戻し、<kbd className="rounded bg-zinc-100 px-1">Alt</kbd> +{" "}
            <kbd className="rounded bg-zinc-100 px-1">→</kbd> で{SEEK_SECONDS}秒送り、
            <kbd className="rounded bg-zinc-100 px-1">Alt</kbd> + <kbd className="rounded bg-zinc-100 px-1">↓</kbd>{" "}
            で再生/停止ができます。
          </p>
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSetUrl();
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 p-2 text-base focus:border-zinc-500 focus:outline-none"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              onClick={handleSetUrl}
              disabled={!urlInput.trim()}
              className="shrink-0 rounded-full bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              設定
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-3">
            <div className="aspect-video w-48 shrink-0 overflow-hidden rounded bg-zinc-100 sm:w-64 [&_iframe]:h-full [&_iframe]:w-full">
              <div ref={containerRef} className="h-full w-full [&>div]:h-full [&>div]:w-full" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="text-sm font-medium tabular-nums text-zinc-700">
                {formatTime(time)}
                {flash && <span className="ml-2 text-xs font-normal text-emerald-700">{flash}</span>}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => seek(-SEEK_SECONDS)}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50"
                >
                  ⏪ {SEEK_SECONDS}秒
                </button>
                <button
                  onClick={togglePlay}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50"
                >
                  ▶/⏸
                </button>
                <button
                  onClick={() => seek(SEEK_SECONDS)}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50"
                >
                  {SEEK_SECONDS}秒 ⏩
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                入力欄で <kbd className="rounded bg-zinc-100 px-1">Alt</kbd>+<kbd className="rounded bg-zinc-100 px-1">←</kbd>{" "}
                戻す / <kbd className="rounded bg-zinc-100 px-1">Alt</kbd>+<kbd className="rounded bg-zinc-100 px-1">→</kbd>{" "}
                送る / <kbd className="rounded bg-zinc-100 px-1">Alt</kbd>+<kbd className="rounded bg-zinc-100 px-1">↓</kbd>{" "}
                再生・停止
              </p>
              <button
                onClick={handleClear}
                className="w-fit text-[11px] text-zinc-500 underline decoration-dotted"
              >
                動画を変更
              </button>
            </div>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
}
