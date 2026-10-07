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

const MB_HEADERS = { "User-Agent": "notion-music-db/1.0 ( example@email.com )" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizeName = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * アーティスト名から、公式スタジオアルバム（リリースグループ）の一覧を古い順に返す。
 * primary-type が Album で、ライブ・コンピレーション・サウンドトラック等の secondary-type を持たないものだけ。
 * 版違い（デラックス盤等）はリリースグループに束ねられるため、アルバム1枚=1件になる。
 * @returns {{ artistName: string, albums: { mbid: string, title: string, releaseDate: string|null }[] }}
 */
export async function searchStudioAlbums(artistName) {
  const artistQuery = encodeURIComponent(`artist:"${artistName.replace(/"/g, "")}"`);
  const artistRes = await fetch(`${BASE_URL}/artist/?query=${artistQuery}&fmt=json&limit=5`, {
    headers: MB_HEADERS,
  });
  if (!artistRes.ok) {
    throw new Error(`MusicBrainzのアーティスト検索に失敗しました (status ${artistRes.status})`);
  }
  const artists = (await artistRes.json()).artists ?? [];
  if (artists.length === 0) throw new Error("アーティストが見つかりませんでした");

  // 完全一致を優先し、なければ検索スコア最上位を使う
  const artist = artists.find((a) => normalizeName(a.name) === normalizeName(artistName)) ?? artists[0];

  const groups = [];
  for (let offset = 0; offset < 300; offset += 100) {
    await sleep(1100); // MusicBrainzは1リクエスト/秒の制限
    const res = await fetch(
      `${BASE_URL}/release-group?artist=${artist.id}&type=album&limit=100&offset=${offset}&fmt=json`,
      { headers: MB_HEADERS }
    );
    if (!res.ok) {
      throw new Error(`MusicBrainzのアルバム一覧取得に失敗しました (status ${res.status})`);
    }
    const data = await res.json();
    groups.push(...(data["release-groups"] ?? []));
    if (offset + 100 >= (data["release-group-count"] ?? 0)) break;
  }

  const albums = groups
    .filter((g) => g["primary-type"] === "Album" && (g["secondary-types"] ?? []).length === 0)
    .map((g) => ({
      mbid: g.id,
      title: g.title,
      releaseDate: parseReleaseDate(g["first-release-date"]),
    }))
    .sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));

  return { artistName: artist.name, albums };
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
