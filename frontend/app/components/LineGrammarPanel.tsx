"use client";

import { useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export type Grammar = {
  translation: string;
  skeleton: string;
  chunks: { text: string; role: string; note: string }[];
  points: string[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export default function LineGrammarPanel({
  trackId,
  lineIndex,
  initialGrammar,
  initialMessages,
}: {
  trackId: string;
  lineIndex: number;
  initialGrammar: Grammar | null;
  initialMessages: ChatMessage[];
}) {
  const [open, setOpen] = useState(false);
  const [grammar, setGrammar] = useState<Grammar | null>(initialGrammar);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  async function generate(regenerate: boolean) {
    if (!BACKEND_URL || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/listening/grammar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId, lineIndex, regenerate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "文法解説の取得に失敗しました");
      setGrammar(data.grammar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && !grammar) generate(false);
  }

  async function handleSend() {
    const message = input.trim();
    if (!BACKEND_URL || !message || sending) return;
    setSending(true);
    setChatError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/listening/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId, lineIndex, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      setMessages((prev) => [...prev, ...data.messages]);
      setInput("");
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="ml-1 text-sm text-zinc-500">
      <button
        onClick={handleToggle}
        className="w-fit text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-700"
      >
        {open ? "🧩 文法解説を閉じる" : grammar ? "🧩 文法解説を開く" : "🧩 文法を解体する"}
        {!open && messages.length > 0 && ` (💬${Math.ceil(messages.length / 2)})`}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-3 rounded-lg border border-zinc-200 p-3">
          {loading && !grammar && <p className="text-xs">文法を分解中...</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {grammar && (
            <div className="flex flex-col gap-2.5 text-zinc-700">
              <p className="break-words text-sm">{grammar.translation}</p>

              <p className="break-words rounded bg-zinc-50 p-2 text-xs leading-relaxed">
                🦴 {grammar.skeleton}
              </p>

              <ul className="flex flex-col gap-1">
                {grammar.chunks.map((chunk, i) => (
                  <li key={i} className="break-words text-xs leading-relaxed">
                    <span className="font-medium text-zinc-800">{chunk.text}</span>
                    <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
                      {chunk.role}
                    </span>
                    {chunk.note && <span className="ml-1.5 text-zinc-500">{chunk.note}</span>}
                  </li>
                ))}
              </ul>

              {grammar.points.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed">
                  {grammar.points.map((point, i) => (
                    <li key={i} className="break-words">
                      {point}
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={() => generate(true)}
                disabled={loading}
                className="w-fit text-xs text-zinc-400 underline decoration-dotted hover:text-zinc-600 disabled:opacity-50"
              >
                {loading ? "作り直し中..." : "↻ 解説を作り直す"}
              </button>
            </div>
          )}

          {grammar && (
            <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3">
              <div className="text-xs font-semibold">💬 この行についてAIに質問</div>

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`whitespace-pre-wrap break-words rounded p-2 text-xs leading-relaxed ${
                    m.role === "user"
                      ? "ml-6 bg-sky-50 text-zinc-800"
                      : "mr-6 bg-zinc-50 text-zinc-700"
                  }`}
                >
                  {m.content}
                </div>
              ))}

              {sending && <p className="mr-6 text-xs">考え中...</p>}
              {chatError && <p className="text-xs text-red-600">{chatError}</p>}

              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={2}
                  placeholder="例: ここの to はなぜ省略されているの？"
                  className="min-w-0 flex-1 resize-none rounded border border-zinc-300 p-2 text-base"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  className="shrink-0 rounded bg-zinc-800 px-3 py-2 text-xs text-white disabled:opacity-40"
                >
                  送信
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
