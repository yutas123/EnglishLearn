const BASE_URL = "https://musicbrainz.org/ws/2";

/** MusicBrainzの日付文字列（YYYY / YYYY-MM / YYYY-MM-DD）から年を取り出す */
export function parseReleaseYear(date) {
  const year = Number(String(date ?? "").slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : null;
}

/** 年・月・日（不明なら省略）から YYYY / YYYY-MM / YYYY-MM-DD 形式の文字列を作る。年が不明ならnull */
export function formatReleaseDate(year, month, day) {
  if (!Number.isInteger(year) || year <= 0) return null;
  let text = String(year).padStart(4, "0");
  if (Number.isInteger(month) && month >= 1 && month <= 12) {
    text += `-${String(month).padStart(2, "0")}`;
    if (Number.isInteger(day) && day >= 1 && day <= 31) text += `-${String(day).padStart(2, "0")}`;
  }
  return text;
}

/** MusicBrainzの日付文字列（YYYY / YYYY-MM / YYYY-MM-DD）をリリース日の保存形式に正規化する */
export function parseReleaseDate(date) {
  const [y, m, d] = String(date ?? "").split("-").map(Number);
  return formatReleaseDate(y, m, d);
}

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
    releaseGroupId: release["release-group"]?.id ?? null,
    albumTitle: release.title,
    releaseYear: parseReleaseYear(release.date),
    releaseDate: parseReleaseDate(release.date),
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
