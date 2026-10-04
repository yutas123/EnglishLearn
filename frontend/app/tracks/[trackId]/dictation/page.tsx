import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import DictationClient, { type Attempt } from "../../../components/DictationClient";
import SpotifyRemote from "../../../components/SpotifyRemote";

export const revalidate = 0;

export default async function DictationPage({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;

  // 歌詞本文はここでは取得しない（答え合わせ前に原文を見せないため、行数だけ数える）
  const [track, lineCount, attempts] = await Promise.all([
    prisma.track.findUnique({ where: { id: trackId }, include: { album: true } }),
    prisma.translation.count({ where: { trackId } }),
    prisma.dictationAttempt.findMany({
      where: { trackId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  if (!track) {
    notFound();
  }

  const initialAttempts: Attempt[] = attempts.map((a) => ({
    id: a.id,
    createdAt: a.createdAt.toISOString(),
    text: a.text,
    scopeLines: (a.scopeLines as number[] | null) ?? null,
    accuracy: a.accuracy,
    totalWords: a.totalWords,
    gapCount: a.gapCount,
    result: a.result as unknown as Attempt["result"],
  }));

  return (
    <main className="flex flex-col gap-6">
      <Link
        href={`/tracks/${track.id}`}
        className="w-fit truncate text-sm text-zinc-500 hover:underline"
      >
        ← 通常表示に戻る
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold">
            ✍️ {track.title}（書き取りモード）
          </h1>
          <p className="break-words text-sm text-zinc-500">{track.album.artistName}</p>
        </div>
        <SpotifyRemote
          trackId={track.id}
          title={track.title}
          artistName={track.album.artistName}
        />
      </header>

      {lineCount === 0 ? (
        <p className="text-sm text-zinc-500">歌詞データがないため、書き取りは使えません。</p>
      ) : (
        <DictationClient
          trackId={track.id}
          initialAttempts={initialAttempts}
          youtubeVideoId={track.youtubeVideoId}
        />
      )}
    </main>
  );
}
