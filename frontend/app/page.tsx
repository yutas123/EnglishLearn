import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/db";
import AddCurrentTrackButton from "./components/AddCurrentTrackButton";
import AddFromGeniusButton from "./components/AddFromGeniusButton";

export const revalidate = 3600;

export default async function HomePage() {
  const albums = await prisma.album.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { tracks: true } } },
  });

  return (
    <main className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">VerseVocab</h1>
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
          <AddCurrentTrackButton />
          <AddFromGeniusButton />
        </div>
      </header>

      {albums.length === 0 ? (
        <p className="text-sm text-zinc-500">
          まだアルバムがありません。上のボタンから追加してください。
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {albums.map((album) => (
            <li key={album.id}>
              <Link
                href={`/albums/${album.id}`}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 transition hover:border-zinc-400"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded bg-zinc-100">
                  {album.coverArtUrl ? (
                    <Image
                      src={album.coverArtUrl}
                      alt={album.albumTitle}
                      fill
                      sizes="200px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <div>
                  <p className="truncate text-sm font-medium">
                    {album.albumTitle}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {album.artistName} · {album._count.tracks}曲
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
