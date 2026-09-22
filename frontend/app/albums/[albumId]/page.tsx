import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const revalidate = 3600;

export default async function AlbumPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  const { albumId } = await params;

  const album = await prisma.album.findUnique({
    where: { id: albumId },
    include: { tracks: { orderBy: { trackNo: "asc" } } },
  });

  if (!album) {
    notFound();
  }

  return (
    <main className="flex flex-col gap-6">
      <Link href="/" className="w-fit text-sm text-zinc-500 hover:underline">
        ← アルバム一覧
      </Link>

      <div className="flex gap-4">
        <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded bg-zinc-100">
          {album.coverArtUrl ? (
            <Image
              src={album.coverArtUrl}
              alt={album.albumTitle}
              fill
              sizes="128px"
              className="object-cover"
            />
          ) : null}
        </div>
        <div className="flex flex-col justify-center gap-1">
          <h1 className="text-xl font-bold">{album.albumTitle}</h1>
          <p className="text-sm text-zinc-500">{album.artistName}</p>
          {album.geniusUrl && (
            <a
              href={album.geniusUrl}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-xs text-zinc-400 hover:underline"
            >
              Genius で見る ↗
            </a>
          )}
        </div>
      </div>

      <ol className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200">
        {album.tracks.map((track) => (
          <li key={track.id}>
            <Link
              href={`/tracks/${track.id}`}
              className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-zinc-50"
            >
              <span className="w-6 text-right text-zinc-400">
                {track.trackNo}
              </span>
              <span className="flex-1">{track.title}</span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
