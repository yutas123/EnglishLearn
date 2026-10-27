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
 * body: { addSources?: [{ url, note }]（確認済み資料の追記。既存は消さない）, removeSource?: url（URLなしのメモはメモ本文。その資料を1件削除）, changes: { "<lineIndex>": ["john:L:2", ...] | { parts: [{ end, v: [...] }] } | null } }
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
  // 確認した資料の追記（既存の一覧は消さない）と、URL指定での1件削除
  const sources: unknown = body?.addSources;
  const removeSource: unknown = body?.removeSource;
  if (
    sources !== undefined &&
    !(
      Array.isArray(sources) &&
      sources.length <= 30 &&
      sources.every(
        (r) =>
          typeof r?.url === "string" &&
          r.url.length <= 500 &&
          (r.note === undefined || (typeof r.note === "string" && r.note.length <= 200)) &&
          // URLは任意。空ならメモが必須
          (r.url === "" ? typeof r.note === "string" && r.note.trim() !== "" : /^https?:\/\/\S+$/.test(r.url))
      )
    )
  ) {
    return NextResponse.json({ error: "資料が不正です（URLはhttp(s)://で始めるか、URLなしならメモを入力してください）" }, { status: 400 });
  }
  if (removeSource !== undefined && typeof removeSource !== "string") {
    return NextResponse.json({ error: "削除する資料が不正です" }, { status: 400 });
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
  let sourceList = ((merged._sources as { url: string; note: string }[] | undefined) ?? []).slice();
  if (typeof removeSource === "string") sourceList = sourceList.filter((r) => (r.url || r.note) !== removeSource);
  if (sources !== undefined) {
    for (const r of sources as { url: string; note?: string }[]) {
      // 同じURLはメモだけ更新し、重複させない。URLなしのメモは同じ文面なら重複させない
      const existing = sourceList.find((x) => (r.url !== "" ? x.url === r.url : x.url === "" && x.note === r.note));
      if (existing) existing.note = r.note ?? existing.note;
      else sourceList.push({ url: r.url, note: r.note ?? "" });
    }
  }
  if (sourceList.length > 30) {
    return NextResponse.json({ error: "資料は30件までです" }, { status: 400 });
  }
  if (sourceList.length > 0) merged._sources = sourceList;
  else delete merged._sources;
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

  return NextResponse.json({ ok: true, sources: sourceList });
}
