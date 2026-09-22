import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const { trackId, lineIndex, startOffset, endOffset } = body ?? {};

  if (
    typeof trackId !== "string" ||
    typeof lineIndex !== "number" ||
    typeof startOffset !== "number" ||
    typeof endOffset !== "number"
  ) {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }

  const highlight = await prisma.highlight.create({
    data: { trackId, lineIndex, startOffset, endOffset },
  });

  return NextResponse.json(highlight);
}
