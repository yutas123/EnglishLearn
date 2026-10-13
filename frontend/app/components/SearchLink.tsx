"use client";

import Link from "next/link";

export const SEARCH_FOCUS_HELPER_ID = "search-focus-helper";

/**
 * 🔍ボタン。iOSのSafariは、ユーザー操作（タップ）の中で行ったfocus()でないとキーボードを出さない。
 * ページ遷移後にautoFocusしてもキーボードが出ないため、タップ時点で画面外の入力欄にフォーカスして
 * キーボードを出しておき、遷移先のテキストエリアがそのフォーカスを引き継ぐ。
 */
export default function SearchLink() {
  function handleClick() {
    if (document.getElementById(SEARCH_FOCUS_HELPER_ID)) return;
    const helper = document.createElement("input");
    helper.id = SEARCH_FOCUS_HELPER_ID;
    helper.setAttribute("aria-hidden", "true");
    helper.tabIndex = -1;
    helper.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;";
    document.body.appendChild(helper);
    helper.focus();
    // 検索ページに遷移しなかった場合に備えて、取り残さない
    setTimeout(() => helper.remove(), 3000);
  }

  return (
    <Link
      href="/search"
      onClick={handleClick}
      aria-label="歌詞を検索"
      title="歌詞を検索"
      className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 text-xs hover:bg-zinc-50"
    >
      🔍
    </Link>
  );
}
