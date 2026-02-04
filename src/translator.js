import OpenAI from "openai";

/**
 * OpenAI APIで歌詞を1行ずつ対訳
 * @param {string[]} lines - 歌詞の行配列
 * @param {string} apiKey - OpenAI APIキー
 * @returns {Array<{original: string, translation: string}>} 対訳配列
 */
export async function translateLyrics(lines, apiKey) {
  const openai = new OpenAI({ apiKey });

  const prompt = `【英語学習教材作成のための翻訳依頼】

私は英語学習者で、洋楽を使って英語を勉強しています。
以下の英文テキストについて、各行の意味を理解するための学習用対訳を作成してください。
これは個人的な英語学習目的であり、商用利用や再配布は行いません。

各行に対して、自然で分かりやすい日本語訳をつけてください。
出力形式は必ず以下のJSON配列形式で返してください：
[
  {"original": "英文1行目", "translation": "日本語訳1行目"},
  {"original": "英文2行目", "translation": "日本語訳2行目"}
]

英文テキスト：
${lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content:
            "あなたは英語学習をサポートする翻訳アシスタントです。学習者が英文の意味を理解できるよう、自然で分かりやすい日本語訳を提供してください。必ずJSON形式で出力してください。",
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

    // デバッグ: APIレスポンスの構造を確認
    console.log(`    🔍 APIレスポンス構造:`, JSON.stringify(parsed, null, 2).slice(0, 500));

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
