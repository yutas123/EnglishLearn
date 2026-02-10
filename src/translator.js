import OpenAI from "openai";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 60000; // 60秒

/**
 * 指定ミリ秒待機
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAI APIで歌詞を1行ずつ対訳
 * @param {string[]} lines - 歌詞の行配列
 * @param {string} apiKey - OpenAI APIキー
 * @returns {Array<{original: string, translation: string}>} 対訳配列
 */
export async function translateLyrics(lines, apiKey) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

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
同じ表現・文法パターンが曲中で繰り返し登場する場合、解説は最初の1回のみとし、2回目以降は空文字にしてください。

JSON形式で出力：
[
  {"original": "フレーズ1", "translation": "日本語訳1", "explanation": ""},
  {"original": "フレーズ2", "translation": "日本語訳2", "explanation": "特殊な表現の解説"}
]

フレーズ一覧：
${lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}`;

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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

      // コスト表示（gpt-5.2 の価格: 入力 $1.75/1M tokens, 出力 $14.00/1M tokens）
      const usage = response.usage;
      if (usage) {
        const inputCost = (usage.prompt_tokens / 1_000_000) * 1.75;
        const outputCost = (usage.completion_tokens / 1_000_000) * 14.00;
        const totalCost = inputCost + outputCost;
        const totalCostYen = totalCost * 150; // 1ドル=150円換算
        console.log(`    💰 コスト: $${totalCost.toFixed(4)} (約${totalCostYen.toFixed(2)}円) [入力:${usage.prompt_tokens} + 出力:${usage.completion_tokens} tokens]`);
      }

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
      lastError = error;
      const isTimeout = error.code === 'ETIMEDOUT' || error.message.includes('timeout');
      const isRetryable = isTimeout || error.status === 429 || error.status >= 500;

      if (attempt < MAX_RETRIES && isRetryable) {
        const waitTime = attempt * 5000; // 5秒、10秒、15秒と増加
        console.log(`    ⚠️ リトライ ${attempt}/${MAX_RETRIES}: ${error.message} (${waitTime / 1000}秒後に再試行)`);
        await sleep(waitTime);
        continue;
      }

      console.log(`    ⚠️ 翻訳エラー: ${error.message}`);
      // フォールバック：原文のみ返す
      return lines.map((line) => ({ original: line, translation: "" }));
    }
  }

  // ここには到達しないはずだが念のため
  console.log(`    ⚠️ 翻訳エラー: ${lastError?.message}`);
  return lines.map((line) => ({ original: line, translation: "" }));
}

/**
 * OpenAI APIで楽曲解説/考察を生成
 * @param {string[]} lines - 歌詞の行配列
 * @param {string} songTitle - 曲名
 * @param {string} artistName - アーティスト名
 * @param {string} apiKey - OpenAI APIキー
 * @returns {string} 楽曲解説テキスト
 */
export async function generateSongAnalysis(lines, songTitle, artistName, apiKey) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  const lyricsText = lines.join("\n");

  const prompt = `【楽曲解説・考察の作成】

以下は「${artistName}」の楽曲「${songTitle}」の歌詞です。
この曲について、英語学習者向けに総合的な解説を作成してください。

【含めてほしい内容】
1. **テーマ・メッセージ**: この曲が伝えようとしている主題や感情
2. **文化的・歴史的背景**: 曲が生まれた時代背景やアーティストの意図（分かる範囲で）
3. **歌詞の解釈・考察**: 比喩表現やストーリーの深い分析

【形式】
- 日本語で記述
- 見出しは使わず、自然な文章で繋げる
- 300〜500文字程度

【歌詞】
${lyricsText}`;

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content:
              "あなたは音楽と英語に精通した解説者です。楽曲の歌詞を分析し、学習者が曲の背景や意味を深く理解できるよう、分かりやすい解説を提供してください。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
      });

      const content = response.choices[0].message.content;

      // コスト表示
      const usage = response.usage;
      if (usage) {
        const inputCost = (usage.prompt_tokens / 1_000_000) * 1.75;
        const outputCost = (usage.completion_tokens / 1_000_000) * 14.0;
        const totalCost = inputCost + outputCost;
        const totalCostYen = totalCost * 150;
        console.log(
          `    💰 解説コスト: $${totalCost.toFixed(4)} (約${totalCostYen.toFixed(2)}円) [入力:${usage.prompt_tokens} + 出力:${usage.completion_tokens} tokens]`
        );
      }

      return content.trim();
    } catch (error) {
      lastError = error;
      const isTimeout =
        error.code === "ETIMEDOUT" || error.message.includes("timeout");
      const isRetryable =
        isTimeout || error.status === 429 || error.status >= 500;

      if (attempt < MAX_RETRIES && isRetryable) {
        const waitTime = attempt * 5000;
        console.log(
          `    ⚠️ リトライ ${attempt}/${MAX_RETRIES}: ${error.message} (${waitTime / 1000}秒後に再試行)`
        );
        await sleep(waitTime);
        continue;
      }

      console.log(`    ⚠️ 解説生成エラー: ${error.message}`);
      return null;
    }
  }

  console.log(`    ⚠️ 解説生成エラー: ${lastError?.message}`);
  return null;
}
