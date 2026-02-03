import { notion, ALBUM_DB_ID, TRACK_DB_ID } from "./config.js";

/**
 * アルバムDBにアルバムを作成
 * @returns {string} 作成したアルバムのページID
 */
export async function createAlbum({ albumName }) {
  const response = await notion.pages.create({
    parent: { database_id: ALBUM_DB_ID },
    properties: {
      アルバム名: {
        title: [{ text: { content: albumName } }],
      },
    },
  });

  return response.id;
}

/**
 * 全曲DBにトラックを作成（アルバムへのリレーション付き）
 */
export async function createTrack({ title, trackNo, albumPageId }) {
  await notion.pages.create({
    parent: { database_id: TRACK_DB_ID },
    properties: {
      曲名: {
        title: [{ text: { content: title } }],
      },
      アルバム名: {
        relation: [{ id: albumPageId }],
      },
      "track list": {
        number: trackNo,
      },
    },
  });
}
