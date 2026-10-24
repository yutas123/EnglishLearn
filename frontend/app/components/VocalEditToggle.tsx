"use client";

import { useState } from "react";

// 歌詞の下線の編集モードを切り替えるヘッダーのアイコン。
// 編集モードの状態は LyricsList が持つため、window のカスタムイベントで伝える。
export const VOCAL_EDIT_EVENT = "vocal-edit-mode";

export default function VocalEditToggle() {
  const [on, setOn] = useState(false);

  return (
    <button
      type="button"
      aria-label="歌詞の下線を編集"
      title="歌詞の下線を編集（誰が歌っているかの線）"
      onClick={() => {
        const next = !on;
        setOn(next);
        window.dispatchEvent(new CustomEvent(VOCAL_EDIT_EVENT, { detail: { on: next } }));
      }}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-base ${
        on ? "border-zinc-900 bg-zinc-900" : "border-zinc-300 hover:bg-zinc-50"
      }`}
    >
      🖍️
    </button>
  );
}
