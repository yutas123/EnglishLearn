import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const TOKEN_PATTERN = /^(john|paul|george|ringo):[LH](:2)?$/;

/**
 * 歌詞の下線（誰が歌っているか）の行単位の上書きを保存する。
 * body: { changes: { "<lineIndex>": ["john:L:2", ...] | null } }
 * 配列は「その行の線の構成（空配列=線なし）」、nullは「上書きを消して初期値に戻す」。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params;
  const body = await req.json().catch(() => null);
  const changes = body?.changes;

  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return NextResponse.json({ error: "changes が不正です" }, { status: 400 });
  }
  for (const [key, value] of Object.entries(changes)) {
    if (!/^\d+$/.test(key)) {
      return NextResponse.json({ error: "行番号が不正です" }, { status: 400 });
    }
    const ok =
      value === null ||
      (Array.isArray(value) &&
        value.length <= 4 &&
        value.every((t) => typeof t === "string" && TOKEN_PATTERN.test(t)));
    if (!ok) {
      return NextResponse.json({ error: "線の指定が不正です" }, { status: 400 });
    }
  }

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { vocalOverrides: true },
  });
  if (!track) {
    return NextResponse.json({ error: "曲が見つかりません" }, { status: 404 });
  }

  const merged: Record<string, string[]> = {
    ...((track.vocalOverrides as Record<string, string[]> | null) ?? {}),
  };
  for (const [key, value] of Object.entries(changes as Record<string, string[] | null>)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }

  await prisma.track.update({
    where: { id: trackId },
    data: {
      vocalOverrides: Object.keys(merged).length > 0 ? merged : Prisma.DbNull,
    },
  });

  // 曲ページは静的生成されているため、保存内容が次の表示にも反映されるよう再生成する
  revalidatePath(`/tracks/${trackId}`);

  return NextResponse.json({ ok: true });
}
