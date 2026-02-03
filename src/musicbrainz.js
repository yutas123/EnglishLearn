const BASE_URL = "https://musicbrainz.org/ws/2";

/**
 * アーティスト名 + アルバム名から Release ID を取得
 */
export async function searchRelease(artist, album) {
  const query = encodeURIComponent(
    `artist:"${artist}" AND release:"${album}"`
  );

  const url = `${BASE_URL}/release/?query=${query}&fmt=json&limit=1`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "notion-music-db/1.0 ( example@email.com )",
    },
  });

  const data = await res.json();

  if (!data.releases || data.releases.length === 0) {
    throw new Error("Release が見つかりませんでした");
  }

  const release = data.releases[0];

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
