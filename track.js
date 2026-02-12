import { processTracks } from "./src/jobs.js";

/**
 * ★ 入力はここだけ ★
 * エラーで失敗した曲を個別に再実行するためのスクリプト
 *
 * ARTIST_NAME: アーティスト名
 * TRACKS: 再実行したい曲の配列
 *   - title: 曲名（Genius検索用）
 *   - notionPageId: 既存のNotionトラックページID
 */
const ARTIST_NAME = "Elliott Smith";
const TRACKS = [
  {
    title: "Southern Belle",
    notionPageId: "2fdf43a6c5f881f2b94dc15de765a64d",
  },
  // 複数曲ある場合は追加
  // {
  //   title: "別の曲名",
  //   notionPageId: "別のページID",
  // },
];

processTracks(ARTIST_NAME, TRACKS).catch(() => process.exit(1));
