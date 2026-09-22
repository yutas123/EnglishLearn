import type { Metadata } from "next";
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
        <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>
      </body>
    </html>
  );
}
