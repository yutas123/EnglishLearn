import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const MAX_RESULTS = 100;

// 全曲の英語歌詞（原文）から単語・熟語を部分一致（大文字小文字無視）で検索する
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (q.length < 2) {
    return NextResponse.json({ results: [], truncated: false });
  }

  const lines = await prisma.translation.findMany({
    where: { original: { contains: q, mode: "insensitive" } },
    orderBy: [{ trackId: "asc" }, { lineIndex: "asc" }],
    take: MAX_RESULTS + 1,
    select: {
      lineIndex: true,
      original: true,
      track: {
        select: {
          id: true,
          title: true,
          album: { select: { albumTitle: true, artistName: true } },
        },
      },
    },
  });

  const truncated = lines.length > MAX_RESULTS;
  return NextResponse.json({
    truncated,
    results: lines.slice(0, MAX_RESULTS).map((l) => ({
      trackId: l.track.id,
      trackTitle: l.track.title,
      albumTitle: l.track.album.albumTitle,
      artistName: l.track.album.artistName,
      lineIndex: l.lineIndex,
      original: l.original,
    })),
  });
}
