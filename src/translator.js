import OpenAI from "openai";

/**
 * OpenAI APIで歌詞を1行ずつ対訳
 * @param {string[]} lines - 歌詞の行配列
 * @param {string} apiKey - OpenAI APIキー
 * @returns {Array<{original: string, translation: string}>} 対訳配列
 */
export async function translateLyrics(lines, apiKey) {
  const openai = new OpenAI({ apiKey });

  const prompt = `以下の英語の歌詞を1行ずつ日本語に翻訳してください。
各行に対して、自然で詩的な日本語訳をつけてください。
出力形式は必ず以下のJSON配列形式で返してください：
[
  {"original": "英語の歌詞1行目", "translation": "日本語訳1行目"},
  {"original": "英語の歌詞2行目", "translation": "日本語訳2行目"}
]

歌詞：
${lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content:
            "あなたは英語の歌詞を日本語に翻訳する専門家です。直訳ではなく、歌詞の雰囲気を保ちながら自然な日本語に訳してください。必ずJSON形式で出力してください。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    // レスポンスの形式に応じて対応
    if (Array.isArray(parsed)) {
      return parsed;
    } else if (parsed.translations) {
      return parsed.translations;
    } else if (parsed.lyrics) {
      return parsed.lyrics;
    }

    // オブジェクトの最初の配列プロパティを探す
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key])) {
        return parsed[key];
      }
    }

    throw new Error("予期しないレスポンス形式");
  } catch (error) {
    console.log(`    ⚠️ 翻訳エラー: ${error.message}`);
    // フォールバック：原文のみ返す
    return lines.map((line) => ({ original: line, translation: "" }));
  }
}
