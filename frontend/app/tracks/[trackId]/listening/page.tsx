import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import ListeningLines from "../../../components/ListeningLines";
import type { Grammar } from "../../../components/LineGrammarPanel";

export const revalidate = 0;

export default async function ListeningPage({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;

  const [track, grammars, chatMessages] = await Promise.all([
    prisma.track.findUnique({
      where: { id: trackId },
      include: {
        album: true,
        translations: { orderBy: { lineIndex: "asc" } },
      },
    }),
    prisma.lineGrammar.findMany({ where: { trackId } }),
    prisma.lineChatMessage.findMany({ where: { trackId }, orderBy: { createdAt: "asc" } }),
  ]);

  if (!track) {
    notFound();
  }

  const grammarByLineIndex = new Map(grammars.map((g) => [g.lineIndex, g]));
  const lines = track.translations.map((line) => {
    const grammar = grammarByLineIndex.get(line.lineIndex);
    return {
      id: line.id,
      lineIndex: line.lineIndex,
      original: line.original,
      translation: line.translation,
      sectionLabel: line.sectionLabel,
      // 歌詞の原文が後から修正されていたら、古い解説は出さない（開き直すと作り直される）
      grammar:
        grammar && grammar.original === line.original
          ? (grammar.content as unknown as Grammar)
          : null,
      chatMessages: chatMessages
        .filter((m) => m.lineIndex === line.lineIndex)
        .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })),
    };
  });

  return (
    <main className="flex flex-col gap-6">
      <Link
        href={`/tracks/${track.id}`}
        className="w-fit truncate text-sm text-zinc-500 hover:underline"
      >
        ← 通常表示に戻る
      </Link>

      <header>
        <h1 className="break-words text-xl font-bold">
          👂 {track.title}（リスニングモード）
        </h1>
        <p className="break-words text-sm text-zinc-500">
          {track.album.artistName}
        </p>
      </header>

      <p className="rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
        Spotifyで聴きながら使うページです。各行の右の <span className="font-semibold">≡</span> で対訳を表示、
        <span className="font-semibold"> パズル</span> で文法解説とAIへの質問ができます。
      </p>

      {lines.length === 0 ? (
        <p className="text-sm text-zinc-500">歌詞データがありません。</p>
      ) : (
        <ListeningLines trackId={track.id} lines={lines} />
      )}
    </main>
  );
}
