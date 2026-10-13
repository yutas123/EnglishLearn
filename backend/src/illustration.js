import OpenAI from "openai";

const TIMEOUT_MS = 120000;

/**
 * コアイメージの文面から、語を象徴するシンプルなイラストを生成する。
 * 低品質＋webp圧縮で1枚約1円・約40KB・約10秒（DBにそのまま保存できるサイズ）。
 * @param {{ term: string, coreImage: string }} input
 * @param {string} apiKey
 * @returns {Promise<{ data: Buffer, mimeType: string }>}
 */
export async function generateIllustration({ term, coreImage }, apiKey) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  const prompt = `Simple flat illustration with soft pastel colors and clean outlines, in a calm picture-book style. No text, no letters, no words, no speech bubbles.
It should convey the core image (the underlying visual sense shared by all meanings) of the English word "${term}" through one clear visual metaphor.
Core image description (Japanese): ${coreImage}`;

  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
    quality: "low",
    output_format: "webp",
    output_compression: 60,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("画像生成のレスポンスに画像データがありません");
  }

  return { data: Buffer.from(b64, "base64"), mimeType: "image/webp" };
}
