import { processAlbum } from "./src/jobs.js";

/**
 * ★ 入力はここだけ ★
 */
const ARTIST_NAME = "The Kinks";
const ALBUM_NAME = "The Kinks are the Village Green Preservation Society";

processAlbum(ARTIST_NAME, ALBUM_NAME).catch(() => process.exit(1));
