import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const occurrences = await prisma.vocabOccurrence.findMany({
    where: { vocabEntryId: id },
    orderBy: { createdAt: "asc" },
    include: {
      track: {
        select: {
          id: true,
          title: true,
          album: { select: { albumTitle: true } },
        },
      },
    },
  });

  return NextResponse.json({
    occurrences: occurrences.map((o) => ({
      trackId: o.trackId,
      trackTitle: o.track.title,
      albumTitle: o.track.album.albumTitle,
      lineIndex: o.lineIndex,
    })),
  });
}
