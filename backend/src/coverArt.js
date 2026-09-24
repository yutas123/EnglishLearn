import { searchAlbumArt } from "./spotify.js";

/**
 * Cover Art Archiveの画像URLが実際に存在するか確認する
 */
async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

/**
 * ジャケット画像URLを複数のソースから優先順位付きで取得する。
 * 1. Spotify検索（画質が良く、MusicBrainzが選んだreleaseと紐付いていなくても見つかる）
 * 2. Cover Art Archive（MusicBrainzが選んだreleaseそのもの）
 * 3. Cover Art Archive（同じrelease-group内の別release。オリジナル盤に画像が
 *    登録されていないケースをカバーする）
 */
export async function getCoverArtUrl({ artistName, albumTitle, releaseId, releaseGroupId }) {
  const spotifyUrl = await searchAlbumArt(artistName, albumTitle);
  if (spotifyUrl) return spotifyUrl;

  if (releaseId) {
    const releaseArt = await checkUrl(`https://coverartarchive.org/release/${releaseId}/front-500`);
    if (releaseArt) return releaseArt;
  }

  if (releaseGroupId) {
    const groupArt = await checkUrl(
      `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`
    );
    if (groupArt) return groupArt;
  }

  return null;
}
