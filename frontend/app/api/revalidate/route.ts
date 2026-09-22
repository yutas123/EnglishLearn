import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const path = body?.path;

  if (typeof path !== "string" || !path.startsWith("/")) {
    return NextResponse.json({ error: "path が不正です" }, { status: 400 });
  }

  revalidatePath(path);
  revalidatePath("/");

  return NextResponse.json({ revalidated: true, path });
}
