"use client";

import { useEffect, useState } from "react";

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
  open,
  initialGrammar,
  initialMessages,
  onGeneratedChange,
}: {
  trackId: string;
  lineIndex: number;
  open: boolean;
  initialGrammar: Grammar | null;
  initialMessages: ChatMessage[];
  // 解説またはチャットが1つでもできたか（親が閉じた状態でも「生成済み」を色で示すため）
  onGeneratedChange?: (generated: boolean) => void;
}) {
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

  // 解説の自動生成はしない。先にユーザーが質問し、必要なら「文法を解体する」ボタンで生成する
  const hasContent = Boolean(grammar) || messages.length > 0;
  useEffect(() => {
    onGeneratedChange?.(hasContent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContent]);

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

  if (!open) return null;

  return (
    <div className="text-base text-zinc-500">
      {(
        <div className="mt-1 flex flex-col gap-3 rounded-lg border border-zinc-200 p-3">
                    {error && <p className="text-xs text-red-600">{error}</p>}

          {grammar && (
            <div className="flex flex-col gap-2.5 text-zinc-700">
              <p className="break-words text-base">{grammar.translation}</p>

              <p className="break-words rounded bg-zinc-50 p-2 text-base leading-relaxed">
                🦴 {grammar.skeleton}
              </p>

              <ul className="flex flex-col gap-1">
                {grammar.chunks.map((chunk, i) => (
                  <li key={i} className="break-words text-base leading-relaxed">
                    <span className="font-medium text-zinc-800">{chunk.text}</span>
                    <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
                      {chunk.role}
                    </span>
                    {chunk.note && <span className="ml-1.5 text-zinc-500">{chunk.note}</span>}
                  </li>
                ))}
              </ul>

              {grammar.points.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 pl-4 text-base leading-relaxed">
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

          <div className={`flex flex-col gap-2 ${grammar ? "border-t border-zinc-100 pt-3" : ""}`}>
              <div className="text-base font-semibold">💬 この文についてAIに質問</div>

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`whitespace-pre-wrap break-words rounded p-2 text-base leading-relaxed ${
                    m.role === "user"
                      ? "ml-6 bg-sky-50 text-zinc-800"
                      : "mr-6 bg-zinc-50 text-zinc-700"
                  }`}
                >
                  {m.content}
                </div>
              ))}

              {sending && <p className="mr-6 text-base">考え中...</p>}
              {chatError && <p className="text-xs text-red-600">{chatError}</p>}

              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={2}
                  placeholder="この文について聞きたいことを入力（例: ここの to はなぜ省略されているの？）"
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

          {!grammar && (
            <button
              onClick={() => generate(false)}
              disabled={loading}
              className="w-fit text-xs text-zinc-400 underline decoration-dotted hover:text-zinc-600 disabled:opacity-50"
            >
              {loading ? "文法を分解中..." : "🧩 文法を解体する（AIが自動で解説）"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
