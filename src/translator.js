import OpenAI from "openai";

/**
 * OpenAI APIで歌詞を1行ずつ対訳
 * @param {string[]} lines - 歌詞の行配列
 * @param {string} apiKey - OpenAI APIキー
 * @returns {Array<{original: string, translation: string}>} 対訳配列
 */
export async function translateLyrics(lines, apiKey) {
  const openai = new OpenAI({ apiKey });

  const prompt = `【英語学習ノート作成 - 対訳と表現解説】

私は英語学習者です。以下の英文フレーズについて、学習ノートを作成しています。
各行の日本語訳を作成してください。

各行について：
1. translation: 自然で分かりやすい日本語訳
2. explanation: 解説（※下記の条件に該当する場合のみ）

【重要】explanationは以下の場合のみ記載してください：
- 倒置、省略など特殊な文法構造がある場合
- 熟語・イディオムで、単語を知っていても意味が推測できないもの
- スラング・口語表現で、一般的な辞書に載っていないもの
- 文化的背景がないと理解できない表現

例：
- "Should you need help" → "Should + 主語 + 動詞"は倒置で「もし〜なら（If …）」の意味
- "break a leg" → 直訳は「足を折れ」だが「頑張れ、幸運を」の意味のイディオム
- "I'm gonna" → "going to"の口語表現 ← これは一般的なので解説不要

普通の文や、基本的な単語・文法で理解できる行には解説は不要です（空文字にしてください）。

JSON形式で出力：
[
  {"original": "フレーズ1", "translation": "日本語訳1", "explanation": ""},
  {"original": "フレーズ2", "translation": "日本語訳2", "explanation": "特殊な表現の解説"}
]

フレーズ一覧：
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
