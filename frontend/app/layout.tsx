import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import NowPlayingButton from "./components/NowPlayingButton";

export const metadata: Metadata = {
  title: "VerseVocab",
  description: "洋楽歌詞で学ぶ対訳・解説",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen font-sans antialiased">
        <div className="mx-auto max-w-3xl px-4 pb-8 pt-16">
          <header className="mb-6 flex items-center justify-between">
            <Link href="/" className="text-sm font-semibold text-zinc-800">
              VerseVocab
            </Link>
            <div className="flex items-center gap-2">
              <Link
                href="/search"
                aria-label="歌詞を検索"
                title="歌詞を検索"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 text-xs hover:bg-zinc-50"
              >
                🔍
              </Link>
              <Link
                href="/vocabulary"
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                📔 単語帳
              </Link>
            </div>
          </header>
          {children}
        </div>
        <NowPlayingButton />
      </body>
    </html>
  );
}
