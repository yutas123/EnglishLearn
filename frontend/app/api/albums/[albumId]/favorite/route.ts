import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  const { albumId } = await params;
  const body = await req.json().catch(() => null);
  const isFavorite = body?.isFavorite;

  if (typeof isFavorite !== "boolean") {
    return NextResponse.json({ error: "isFavorite が不正です" }, { status: 400 });
  }

  const album = await prisma.album.findUnique({ where: { id: albumId }, select: { id: true } });
  if (!album) {
    return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
  }

  await prisma.album.update({ where: { id: albumId }, data: { isFavorite } });

  // 一覧（ピン留め表示）とアルバムページ（星の状態）は静的生成されているため再生成する
  revalidatePath("/");
  revalidatePath(`/albums/${albumId}`);

  return NextResponse.json({ isFavorite });
}
