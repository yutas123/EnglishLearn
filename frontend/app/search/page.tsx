import SearchClient from "./SearchClient";

export default function SearchPage() {
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">🔍 歌詞を検索</h1>
      <SearchClient />
    </main>
  );
}
