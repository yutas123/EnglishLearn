import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  MEMBERS,
  DEFAULT_ORDER,
  applySongOrder,
  resolveLineParts,
  resolveSources,
  resolveSongOrder,
  resolveVoices,
} from "@/lib/beatles";
import { buildMatcher, findKnownSpans, type MatchSpan } from "@/lib/vocabMatcher";
import LyricsList from "../../components/LyricsList";
import SpotifyRemote from "../../components/SpotifyRemote";
import RetryLyricsButton from "../../components/RetryLyricsButton";
import VocalEditToggle from "../../components/VocalEditToggle";
import TrackTitle from "../../components/TrackTitle";

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
        sourceLineIndex: true,
        sourceTrack: { select: { title: true } },
      },
    }),
  ]);

  if (!track) {
    notFound();
  }
  const matcher = buildMatcher(
    vocabEntries.map(({ sourceTrack, ...entry }) => ({ ...entry, sourceTrackTitle: sourceTrack.title }))
  );
  const songOrder = resolveSongOrder(track.vocalOverrides);
  const linesWithSpans = track.translations.map((line) => {
    return {
      ...line,
      knownSpans: findKnownSpans(line.original, matcher),
      hardSpans: (line.hardSpans as MatchSpan[] | null) ?? [],
      parts: resolveLineParts(
        track.vocalParts,
        track.vocalOverrides,
        line.lineIndex,
        line.sectionLabel,
        line.original.length
      ),
      defaultParts: applySongOrder(
        [{ end: line.original.length, voices: resolveVoices(track.vocalParts, line.sectionLabel) }],
        songOrder ?? DEFAULT_ORDER
      ),
    };
  });

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
          <TrackTitle title={track.title} spans={findKnownSpans(track.title, matcher)} />
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
          <Link
            href={`/tracks/${track.id}/dictation`}
            aria-label="書き取りモード"
            title="書き取りモード（聞こえた英語を書いて答え合わせ）"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-base hover:bg-zinc-50"
          >
            ✍️
          </Link>
          {track.album.artistName.includes("Beatles") && <VocalEditToggle />}
        </div>
      </header>

      {(track.songwriterNote || track.leadVocalNote) && (
        <section className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600">
          {track.songwriterNote && (
            <p>
              <span className="mr-2 text-xs font-medium text-zinc-400">作曲</span>
              {track.songwriterNote}
            </p>
          )}
          {track.leadVocalNote && (
            <p>
              <span className="mr-2 text-xs font-medium text-zinc-400">リード</span>
              {track.leadVocalNote}
            </p>
          )}
          {(track.vocalParts != null || track.vocalOverrides != null) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              <span>歌詞の下線:</span>
              {Object.values(MEMBERS).map((m) => (
                <span key={m.name} className="flex items-center gap-1">
                  <span
                    className="inline-block h-[3px] w-4 rounded-full"
                    style={{ backgroundColor: m.color }}
                  />
                  {m.name}
                </span>
              ))}
              <span className="text-zinc-400">濃い線=リード / 薄い線=ハモリ / 二重線=ダブルトラック</span>
            </p>
          )}
        </section>
      )}

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
        <RetryLyricsButton trackId={track.id} />
      ) : (
        <LyricsList
          trackId={track.id}
          lines={linesWithSpans}
          title={track.title}
          artistName={track.album.artistName}
          canEditVocals={track.album.artistName.includes("Beatles")}
          initialSongOrder={songOrder}
          initialSources={resolveSources(track.vocalOverrides)}
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
