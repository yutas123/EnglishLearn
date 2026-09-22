import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import HighlightableLyrics from "../../components/HighlightableLyrics";

export const revalidate = 3600;

export default async function TrackPage({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: {
      album: true,
      translations: { orderBy: { lineIndex: "asc" } },
      highlights: true,
    },
  });

  if (!track) {
    notFound();
  }

  const otherTracks = await prisma.track.findMany({
    where: { albumId: track.albumId },
    orderBy: { trackNo: "asc" },
    select: { id: true, trackNo: true, title: true },
  });

  const currentIndex = otherTracks.findIndex((t) => t.id === track.id);
  const prevTrack = currentIndex > 0 ? otherTracks[currentIndex - 1] : null;
  const nextTrack =
    currentIndex >= 0 && currentIndex < otherTracks.length - 1
      ? otherTracks[currentIndex + 1]
      : null;

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between text-sm">
        <Link
          href={`/albums/${track.albumId}`}
          className="text-zinc-500 hover:underline"
        >
          ← {track.album.albumTitle}
        </Link>
        <div className="flex gap-3">
          {prevTrack && (
            <Link href={`/tracks/${prevTrack.id}`} className="hover:underline">
              ← 前の曲
            </Link>
          )}
          {nextTrack && (
            <Link href={`/tracks/${nextTrack.id}`} className="hover:underline">
              次の曲 →
            </Link>
          )}
        </div>
      </div>

      <header>
        <h1 className="text-xl font-bold">{track.title}</h1>
        <p className="text-sm text-zinc-500">{track.album.artistName}</p>
      </header>

      {track.analysis && (
        <details className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600">
          <summary className="cursor-pointer select-none font-medium text-zinc-800">
            📖 楽曲解説
          </summary>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">
            {track.analysis}
          </p>
        </details>
      )}

      {track.translations.length === 0 ? (
        <p className="text-sm text-zinc-500">歌詞データがありません。</p>
      ) : (
        <HighlightableLyrics
          trackId={track.id}
          lines={track.translations}
          highlights={track.highlights}
        />
      )}
    </main>
  );
}
