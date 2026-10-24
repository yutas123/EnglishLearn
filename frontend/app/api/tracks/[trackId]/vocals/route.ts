import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const MEMBER_KEYS = ["john", "paul", "george", "ringo"];
const TOKEN_PATTERN = /^(john|paul|george|ringo):[LH](:2)?$/;

type Change = string[] | { parts: { end: number; v: string[] }[] } | null;

const isTokens = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 4 && v.every((t) => typeof t === "string" && TOKEN_PATTERN.test(t));

function isValidChange(value: unknown): value is Change {
  if (value === null || isTokens(value)) return true;
  const parts = (value as { parts?: unknown } | undefined)?.parts;
  return (
    Array.isArray(parts) &&
    parts.length >= 1 &&
    parts.length <= 20 &&
    parts.every(
      (p) =>
        Number.isInteger(p?.end) && p.end > 0 && p.end <= 1000 && isTokens(p.v)
    )
  );
}

/**
 * 歌詞の下線（誰が歌っているか）の行単位の上書きを保存する。
 * body: { changes: { "<lineIndex>": ["john:L:2", ...] | { parts: [{ end, v: [...] }] } | null } }
 * 配列は「その行全体の線の構成（空配列=線なし）」、parts は「行内を文字位置で区切った部分ごとの構成」
 * （end は部分の終わりの文字位置）、nullは「上書きを消して初期値に戻す」。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params;
  const body = await req.json().catch(() => null);
  const changes = body?.changes ?? {};
  // 曲全体の並び順（上から）。null で解除。undefined なら変更しない
  const order: unknown = body?.order;

  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return NextResponse.json({ error: "changes が不正です" }, { status: 400 });
  }
  if (
    order !== undefined &&
    order !== null &&
    !(
      Array.isArray(order) &&
      order.length >= 1 &&
      order.length <= 4 &&
      new Set(order).size === order.length &&
      order.every((m) => typeof m === "string" && MEMBER_KEYS.includes(m))
    )
  ) {
    return NextResponse.json({ error: "並び順が不正です" }, { status: 400 });
  }
  for (const [key, value] of Object.entries(changes)) {
    if (!/^\d+$/.test(key)) {
      return NextResponse.json({ error: "行番号が不正です" }, { status: 400 });
    }
    if (!isValidChange(value)) {
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

  const merged: Record<string, unknown> = {
    ...((track.vocalOverrides as Record<string, unknown> | null) ?? {}),
  };
  if (order === null) delete merged._order;
  else if (order !== undefined) merged._order = order;
  for (const [key, value] of Object.entries(changes as Record<string, Change>)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }

  await prisma.track.update({
    where: { id: trackId },
    data: {
      vocalOverrides: Object.keys(merged).length > 0 ? (merged as Prisma.InputJsonObject) : Prisma.DbNull,
    },
  });

  // 曲ページは静的生成されているため、保存内容が次の表示にも反映されるよう再生成する
  revalidatePath(`/tracks/${trackId}`);

  return NextResponse.json({ ok: true });
}
