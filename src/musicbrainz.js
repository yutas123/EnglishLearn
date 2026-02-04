const BASE_URL = "https://musicbrainz.org/ws/2";

/**
 * アーティスト名 + アルバム名から Release ID を取得（オリジナル版優先）
 */
export async function searchRelease(artist, album) {
  const query = encodeURIComponent(
    `artist:"${artist}" AND release:"${album}"`
  );

  // 複数の候補を取得
  const url = `${BASE_URL}/release/?query=${query}&fmt=json&limit=20`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "notion-music-db/1.0 ( example@email.com )",
    },
  });

  const data = await res.json();

  if (!data.releases || data.releases.length === 0) {
    throw new Error("Release が見つかりませんでした");
  }

  // オリジナル版を優先：リリース日が最も古いものを選択
  const releases = data.releases
    .filter((r) => r.status === "Official") // 公式リリースのみ
    .filter((r) => r.date) // 日付があるもののみ
    .sort((a, b) => {
      // 日付で昇順ソート（古い順）
      return new Date(a.date) - new Date(b.date);
    });

  // 公式リリースがない場合は最初の結果を使用
  const release = releases.length > 0 ? releases[0] : data.releases[0];

  console.log(`📅 選択されたリリース: ${release.title} (${release.date || "日付不明"}, ${release.country || "国不明"})`);

  return {
    releaseId: release.id,
    albumTitle: release.title,
  };
}

/**
 * Release ID からトラックリスト取得
 */
export async function getTrackList(releaseId) {
  const url = `${BASE_URL}/release/${releaseId}?inc=recordings&fmt=json`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "notion-music-db/1.0 ( example@email.com )",
    },
  });

  const data = await res.json();

  const tracks = [];

  for (const medium of data.media) {
    for (const track of medium.tracks) {
      tracks.push({
        trackNo: Number(track.position),
        title: track.title,
      });
    }
  }

  return tracks;
}
