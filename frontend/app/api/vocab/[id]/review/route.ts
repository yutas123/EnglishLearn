import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeNextReview, type ReviewQuality } from "@/lib/srs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const quality = body?.quality as ReviewQuality | undefined;

  if (!quality || !["again", "good", "easy"].includes(quality)) {
    return NextResponse.json({ error: "quality が不正です" }, { status: 400 });
  }

  const entry = await prisma.vocabEntry.findUnique({ where: { id } });
  if (!entry) {
    return NextResponse.json({ error: "語彙が見つかりません" }, { status: 404 });
  }

  const next = computeNextReview(
    {
      easeFactor: entry.easeFactor,
      intervalDays: entry.intervalDays,
      repetitions: entry.repetitions,
    },
    quality
  );

  await prisma.vocabEntry.update({
    where: { id },
    data: {
      easeFactor: next.easeFactor,
      intervalDays: next.intervalDays,
      repetitions: next.repetitions,
      nextReviewAt: next.nextReviewAt,
      lastReviewedAt: new Date(),
    },
  });

  return NextResponse.json({ nextReviewAt: next.nextReviewAt, intervalDays: next.intervalDays });
}
