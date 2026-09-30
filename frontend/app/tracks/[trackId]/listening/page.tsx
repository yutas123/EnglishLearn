import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import ListeningLines from "../../../components/ListeningLines";

export const revalidate = 0;

export default async function ListeningPage({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;

  const [track, marks] = await Promise.all([
    prisma.track.findUnique({
      where: { id: trackId },
      include: {
        album: true,
        translations: { orderBy: { lineIndex: "asc" } },
      },
    }),
    prisma.listeningMark.findMany({ where: { trackId } }),
  ]);

  if (!track) {
    notFound();
  }

  const markedLineIndexes = new Set(marks.map((m) => m.lineIndex));
  const lines = track.translations.map((line) => ({
    id: line.id,
    lineIndex: line.lineIndex,
    original: line.original,
    translation: line.translation,
    sectionLabel: line.sectionLabel,
    isMarked: markedLineIndexes.has(line.lineIndex),
  }));

  return (
    <main className="flex flex-col gap-6">
      <Link
        href={`/tracks/${track.id}`}
        className="w-fit truncate text-sm text-zinc-500 hover:underline"
      >
        ← 通常表示に戻る
      </Link>

      <header>
        <h1 className="break-words text-xl font-bold">
          👂 {track.title}（リスニングモード）
        </h1>
        <p className="break-words text-sm text-zinc-500">
          {track.album.artistName}
        </p>
      </header>

      <p className="rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
        対訳は表示されません。Spotifyで聴きながら、聞き取れなかった行をタップしてマークしてください。
        マークした行は下の「🔎 確認する」から訳と解説を見られます。
      </p>

      {lines.length === 0 ? (
        <p className="text-sm text-zinc-500">歌詞データがありません。</p>
      ) : (
        <ListeningLines trackId={track.id} lines={lines} />
      )}
    </main>
  );
}
