import Link from "next/link";
import { prisma } from "@/lib/db";
import OccurrencesPanel from "./components/OccurrencesPanel";

const PAGE_SIZE = 30;

export default async function VocabularyPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const [entries, total] = await Promise.all([
    prisma.vocabEntry.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: {
        sourceTrack: {
          select: { id: true, title: true, album: { select: { albumTitle: true } } },
        },
        _count: { select: { occurrences: true } },
      },
    }),
    prisma.vocabEntry.count(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">📔 単語帳</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-500">{total}語</span>
          <Link
            href="/vocabulary/review"
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
          >
            🔁 復習する
          </Link>
        </div>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">
          まだ登録された語彙がありません。歌詞ページで英文をドラッグ選択して「登録」してみてください。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{entry.term}</span>
                {entry.partOfSpeech && (
                  <span className="text-xs text-zinc-400">[{entry.partOfSpeech}]</span>
                )}
                {entry.cefr && (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                    {entry.cefr}
                  </span>
                )}
              </div>
              <p className="break-words text-sm text-zinc-600">{entry.meaning}</p>
              <Link
                href={`/tracks/${entry.sourceTrack.id}`}
                className="w-fit text-xs text-zinc-400 hover:underline"
              >
                🎵 {entry.sourceTrack.album.albumTitle} - {entry.sourceTrack.title}
              </Link>
              <OccurrencesPanel
                vocabEntryId={entry.id}
                count={entry._count.occurrences}
              />
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm font-medium">
          {page > 1 ? (
            <Link href={`/vocabulary?page=${page - 1}`} className="hover:underline">
              ← 前へ
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-zinc-400">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/vocabulary?page=${page + 1}`} className="hover:underline">
              次へ →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
