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
 * @returns {string} 作成したトラックのページID
 */
export async function createTrack({ title, trackNo, albumPageId }) {
  const response = await notion.pages.create({
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

  return response.id;
}

/**
 * ページに対訳歌詞を追加
 * @param {string} pageId - NotionページID
 * @param {Array<{original: string, translation: string}>} translations - 対訳配列
 */
export async function addLyricsToPage(pageId, translations) {
  // Notionブロックの配列を作成
  const blocks = [];

  // 見出しを追加
  blocks.push({
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: "Lyrics / 対訳" } }],
    },
  });

  // 各行の対訳を追加
  for (const { original, translation } of translations) {
    // 英語原文
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: { content: original },
            annotations: { bold: true },
          },
        ],
      },
    });

    // 日本語訳
    if (translation) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: translation },
              annotations: { color: "gray" },
            },
          ],
        },
      });
    }

    // 空行（区切り）
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [],
      },
    });
  }

  // Notion APIは一度に100ブロックまで
  const chunkSize = 100;
  for (let i = 0; i < blocks.length; i += chunkSize) {
    const chunk = blocks.slice(i, i + chunkSize);
    await notion.blocks.children.append({
      block_id: pageId,
      children: chunk,
    });
  }
}
