import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "EnglishLearn",
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
        <div className="mx-auto max-w-3xl px-4 py-8">
          <header className="mb-6 flex items-center justify-between">
            <Link href="/" className="text-sm font-semibold text-zinc-800">
              EnglishLearn
            </Link>
            <Link
              href="/vocabulary"
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
            >
              📔 単語帳
            </Link>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
