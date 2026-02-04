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
 * アルバムページにトラックリストを追加
 * @param {string} albumPageId - アルバムのNotionページID
 * @param {Array<{trackNo: number, title: string, pageId: string}>} tracks - トラック情報配列
 */
export async function addTrackListToAlbum(albumPageId, tracks) {
  // trackNoで昇順ソート
  const sortedTracks = [...tracks].sort((a, b) => a.trackNo - b.trackNo);

  const blocks = [];

  // 見出しを追加
  blocks.push({
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: "Track List" } }],
    },
  });

  // 各トラックを番号付きリストで追加（ページへのリンク付き）
  for (const track of sortedTracks) {
    blocks.push({
      object: "block",
      type: "numbered_list_item",
      numbered_list_item: {
        rich_text: [
          {
            type: "mention",
            mention: {
              type: "page",
              page: { id: track.pageId },
            },
          },
        ],
      },
    });
  }

  await notion.blocks.children.append({
    block_id: albumPageId,
    children: blocks,
  });
}

/**
 * ページに対訳歌詞を追加
 * @param {string} pageId - NotionページID
 * @param {Array<{original: string, translation: string}>} translations - 対訳配列
 */
export async function addLyricsToPage(pageId, translations) {
  // Notionブロックの配列を作成
  const blocks = [];

  // 各行の対訳を追加
  for (const item of translations) {
    // originalが未定義の場合はスキップ
    const original = item.original || item.line || item.text || item.english || "";
    const translation = item.translation || item.meaning || item.japanese || item.translated || "";
    const explanation = item.explanation || "";

    if (!original) continue;

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

    // 解説がある場合はトグルブロックで追加
    if (explanation) {
      blocks.push({
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: [
            {
              type: "text",
              text: { content: "💡 解説" },
              annotations: { color: "gray", italic: true },
            },
          ],
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: explanation },
                  },
                ],
              },
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
