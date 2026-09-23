import Link from "next/link";
import { prisma } from "@/lib/db";
import ReviewSession from "./ReviewSession";

export const dynamic = "force-dynamic";

export default async function VocabularyReviewPage() {
  const cards = await prisma.vocabEntry.findMany({
    where: { nextReviewAt: { lte: new Date() } },
    orderBy: { nextReviewAt: "asc" },
    take: 20,
    select: { id: true, term: true, meaning: true, partOfSpeech: true, cefr: true },
  });

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">🔁 復習</h1>
        <Link href="/vocabulary" className="text-sm text-zinc-500 hover:underline">
          単語帳へ →
        </Link>
      </header>

      <ReviewSession cards={cards} />
    </main>
  );
}
