import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { buildMatcher, findKnownSpans, type MatchSpan } from "@/lib/vocabMatcher";
import LyricsList from "../../components/LyricsList";
import SpotifyRemote from "../../components/SpotifyRemote";

export const revalidate = 3600;

export default async function TrackPage({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;

  // track本体と語彙一覧は互いに依存しないため並列に取得し、DB往復回数を減らす
  const [track, vocabEntries] = await Promise.all([
    prisma.track.findUnique({
      where: { id: trackId },
      include: {
        album: true,
        translations: { orderBy: { lineIndex: "asc" } },
      },
    }),
    prisma.vocabEntry.findMany({
      select: {
        id: true,
        term: true,
        isPhrase: true,
        meaning: true,
        partOfSpeech: true,
        cefr: true,
        ipa: true,
        explanation: true,
        sourceTrackId: true,
      },
    }),
  ]);

  if (!track) {
    notFound();
  }
  const matcher = buildMatcher(vocabEntries);
  const linesWithSpans = track.translations.map((line) => ({
    ...line,
    knownSpans: findKnownSpans(line.original, matcher),
    hardSpans: (line.hardSpans as MatchSpan[] | null) ?? [],
  }));

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
      <Link
        href={`/albums/${track.albumId}`}
        className="w-fit truncate text-sm text-zinc-500 hover:underline"
      >
        ← {track.album.albumTitle}
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold">{track.title}</h1>
          <p className="break-words text-sm text-zinc-500">
            {track.album.artistName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SpotifyRemote
            trackId={track.id}
            title={track.title}
            artistName={track.album.artistName}
          />
          <Link
            href={`/tracks/${track.id}/listening`}
            aria-label="リスニングモード"
            title="リスニングモード（聞き取れなかった箇所をマーク）"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-base hover:bg-zinc-50"
          >
            👂
          </Link>
        </div>
      </header>

      {track.analysis && (
        <details className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600">
          <summary className="cursor-pointer select-none font-medium text-zinc-800">
            📖 楽曲解説
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">
            {track.analysis}
          </p>
        </details>
      )}

      {track.translations.length === 0 ? (
        <p className="text-sm text-zinc-500">歌詞データがありません。</p>
      ) : (
        <LyricsList
          trackId={track.id}
          lines={linesWithSpans}
          title={track.title}
          artistName={track.album.artistName}
        />
      )}

      <nav className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-4 text-sm font-medium">
        {prevTrack ? (
          <Link
            href={`/tracks/${prevTrack.id}`}
            className="truncate hover:underline"
          >
            ← 前の曲
          </Link>
        ) : (
          <span />
        )}
        {nextTrack ? (
          <Link
            href={`/tracks/${nextTrack.id}`}
            className="truncate hover:underline"
          >
            次の曲 →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
