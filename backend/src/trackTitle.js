// Spotify の曲名（"Another Girl - Remastered 2009" など）と、DB の曲名（"Another Girl"）を
// 同じ曲として突き合わせるための正規化。frontend/src/lib/trackTitle.ts と同じ内容に保つこと。

export function normalizeTrackTitle(s) {
  return s
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    // " - Remastered 2009" / " - Mono Version" など、ハイフン以降の版情報
    .replace(/\s+-\s+.*(remaster|mono|stereo|version|mix|edit|live|demo|take|anniversary).*$/, "")
    // "(Remastered 2009)" / "[Mono]" など括弧内の版情報
    .replace(/[(\[][^)\]]*(remaster|mono|stereo|version|mix|edit|live|demo|take|anniversary)[^)\]]*[)\]]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function sameTrackTitle(a, b) {
  return normalizeTrackTitle(a) === normalizeTrackTitle(b);
}
