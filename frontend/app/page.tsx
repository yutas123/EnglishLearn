import { prisma } from "@/lib/db";
import AlbumGrid from "./components/AlbumGrid";
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
        <AlbumGrid
          albums={albums.map((a) => ({
            id: a.id,
            artistName: a.artistName,
            albumTitle: a.albumTitle,
            coverArtUrl: a.coverArtUrl,
            trackCount: a._count.tracks,
            releaseYear: a.releaseYear,
            isFavorite: a.isFavorite,
          }))}
        />
      )}
    </main>
  );
}
