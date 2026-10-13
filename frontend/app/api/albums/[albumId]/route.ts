import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  const { albumId } = await params;

  const album = await prisma.album.findUnique({ where: { id: albumId }, select: { id: true } });
  if (!album) {
    return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
  }

  const trackIds = (
    await prisma.track.findMany({ where: { albumId }, select: { id: true } })
  ).map((t) => t.id);
  const trackFilter = { trackId: { in: trackIds } };

  // VocabEntry は出典曲(sourceTrackId)が必須のため、このアルバム由来の単語は一緒に削除する。
  // 他アルバムでの出現記録(VocabOccurrence)が残らないよう、単語側の出現記録も先に消す。
  const vocabIds = (
    await prisma.vocabEntry.findMany({
      where: { sourceTrackId: { in: trackIds } },
      select: { id: true },
    })
  ).map((v) => v.id);

  await prisma.$transaction([
    prisma.vocabOccurrence.deleteMany({
      where: { OR: [trackFilter, { vocabEntryId: { in: vocabIds } }] },
    }),
    prisma.vocabEntry.deleteMany({ where: { id: { in: vocabIds } } }),
    prisma.translation.deleteMany({ where: trackFilter }),
    prisma.highlight.deleteMany({ where: trackFilter }),
    prisma.spanExplanation.deleteMany({ where: trackFilter }),
    prisma.listeningMark.deleteMany({ where: trackFilter }),
    prisma.lineGrammar.deleteMany({ where: trackFilter }),
    prisma.lineChatMessage.deleteMany({ where: trackFilter }),
    prisma.dictationAttempt.deleteMany({ where: trackFilter }),
    prisma.trackLineNote.deleteMany({ where: trackFilter }),
    prisma.track.deleteMany({ where: { albumId } }),
    prisma.album.delete({ where: { id: albumId } }),
  ]);

  revalidatePath("/");
  revalidatePath(`/albums/${albumId}`);

  return NextResponse.json({ ok: true });
}
