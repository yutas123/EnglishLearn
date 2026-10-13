import Link from "next/link";
import { prisma } from "@/lib/db";
import OccurrencesPanel from "./components/OccurrencesPanel";
import CoreIllustration from "./components/CoreIllustration";

const PAGE_SIZE = 30;

export default async function VocabularyPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tab?: string }>;
}) {
  const { page: pageParam, tab } = await searchParams;

  if (tab === "core") {
    return <CoreImageTab />;
  }

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
      <Tabs active="vocab" />
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
                {entry.ipa && (
                  <span className="text-xs text-zinc-400">{entry.ipa}</span>
                )}
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

function Tabs({ active }: { active: "vocab" | "core" }) {
  const base = "rounded-full px-4 py-1.5 text-xs font-medium";
  const on = "bg-zinc-900 text-white";
  const off = "border border-zinc-300 hover:bg-zinc-50";
  return (
    <nav className="flex gap-2">
      <Link href="/vocabulary" className={`${base} ${active === "vocab" ? on : off}`}>
        📔 単語
      </Link>
      <Link href="/vocabulary?tab=core" className={`${base} ${active === "core" ? on : off}`}>
        🧠 コアイメージ
      </Link>
    </nav>
  );
}

// 知っているはずの平易な語が「別の用法」で出てきて訳せなかったものを貯める箱
async function CoreImageTab() {
  const entries = await prisma.coreImageEntry.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      illustration: { select: { createdAt: true } },
      usages: {
        orderBy: { createdAt: "desc" },
        include: {
          track: {
            select: { id: true, title: true, album: { select: { albumTitle: true } } },
          },
        },
      },
    },
  });

  return (
    <main className="flex flex-col gap-6">
      <Tabs active="core" />
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">🧠 コアイメージ</h1>
        <span className="text-sm text-zinc-500">{entries.length}語</span>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">
          まだ保存された語がありません。歌詞ページで知っているはずの単語を選び、「🧠 コア」→「🧠 保存」してみてください。
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold">{entry.term}</span>
                <span className="text-xs text-zinc-400">{entry.usages.length}件の用法</span>
              </div>
              <CoreIllustration
                entryId={entry.id}
                term={entry.term}
                version={entry.illustration?.createdAt.getTime() ?? null}
              />
              <p className="break-words rounded bg-pink-50 p-3 text-sm leading-relaxed text-zinc-700">
                {entry.coreImage}
              </p>
              <ul className="flex flex-col divide-y divide-zinc-100">
                {entry.usages.map((usage) => (
                  <li key={usage.id} className="flex flex-col gap-1 py-2 text-sm">
                    <p className="break-words text-zinc-700">
                      <span className="font-medium">{usage.selectedText}</span>
                      <span className="text-zinc-400"> — </span>
                      {usage.translation}
                    </p>
                    <p className="break-words text-xs text-zinc-500">{usage.roleInLine}</p>
                    <Link
                      href={`/tracks/${usage.track.id}#line-${usage.lineIndex}`}
                      className="w-fit text-xs text-zinc-400 hover:underline"
                    >
                      🎵 {usage.track.album.albumTitle} - {usage.track.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
