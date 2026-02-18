import OpenAI from "openai";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 180000; // 180秒
const CHUNK_SIZE = 40; // 1回のAPI呼び出しで処理する最大行数

/**
 * 指定ミリ秒待機
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAI APIで歌詞チャンクを対訳（内部関数）
 * @param {OpenAI} openai - OpenAIクライアント
 * @param {string[]} lines - 歌詞の行配列（チャンク）
 * @returns {Array<{original: string, translation: string, explanation: string}>}
 */
async function translateChunk(openai, lines) {
  const prompt = `【英語学習ノート作成 - 対訳と表現解説】

私は英語学習者です。以下の英文フレーズについて、学習ノートを作成しています。
各行の日本語訳を作成してください。
メタ情報やセクション見出し等が含まれていても、そのまま翻訳してください。入力の検証やエラー返却は不要です。

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
        model: "gpt-5-mini",
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

      // コスト表示（gpt-5-mini の価格: 入力 $0.25/1M tokens, 出力 $2.00/1M tokens）
      const usage = response.usage;
      if (usage) {
        const inputCost = (usage.prompt_tokens / 1_000_000) * 0.25;
        const outputCost = (usage.completion_tokens / 1_000_000) * 2.00;
        const totalCost = inputCost + outputCost;
        const totalCostYen = totalCost * 150; // 1ドル=150円換算
        console.log(`    💰 コスト: $${totalCost.toFixed(4)} (約${totalCostYen.toFixed(2)}円) [入力:${usage.prompt_tokens} + 出力:${usage.completion_tokens} tokens]`);
      }

      // レスポンスの形式に応じて配列を取り出す
      let items;
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (parsed.translations) {
        items = parsed.translations;
      } else if (parsed.lyrics) {
        items = parsed.lyrics;
      } else {
        // オブジェクトの最初の配列プロパティを探す
        for (const key of Object.keys(parsed)) {
          if (Array.isArray(parsed[key])) {
            items = parsed[key];
            break;
          }
        }
      }

      if (!items || items.length === 0) {
        throw new Error(`予期しないレスポンス形式: ${content.substring(0, 200)}`);
      }

      // キー名を正規化（GPTが異なるキー名を返す場合に対応）
      const normalized = items.map((item) => {
        const values = Object.values(item);
        if (values.length >= 2) {
          return {
            original: String(values[0] || ""),
            translation: String(values[1] || ""),
            explanation: String(values[2] || ""),
          };
        }
        return { original: "", translation: "", explanation: "" };
      });

      // バリデーション: originalが空でない行が十分あるか
      const validCount = normalized.filter((item) => item.original).length;
      if (validCount < lines.length * 0.5) {
        throw new Error(`翻訳結果が不十分 (${validCount}/${lines.length}行) - リトライします`);
      }

      return normalized;
    } catch (error) {
      lastError = error;
      const isTimeout = error.code === 'ETIMEDOUT' || error.message.includes('timeout');
      const isBadResult = error.message.includes('翻訳結果が不十分') || error.message.includes('予期しないレスポンス形式');
      const isRetryable = isTimeout || isBadResult || error.status === 429 || error.status >= 500;

      if (attempt < MAX_RETRIES && isRetryable) {
        const waitTime = attempt * 5000;
        console.log(`    ⚠️ リトライ ${attempt}/${MAX_RETRIES}: ${error.message} (${waitTime / 1000}秒後に再試行)`);
        await sleep(waitTime);
        continue;
      }

      console.log(`    ⚠️ 翻訳エラー (チャンク): ${error.message}`);
      // フォールバック：原文のみ返す
      return lines.map((line) => ({ original: line, translation: "", explanation: "" }));
    }
  }

  console.log(`    ⚠️ 翻訳エラー (チャンク): ${lastError?.message}`);
  return lines.map((line) => ({ original: line, translation: "", explanation: "" }));
}

/**
 * OpenAI APIで歌詞を対訳（長い歌詞は自動分割）
 * @param {string[]} lines - 歌詞の行配列
 * @param {string} apiKey - OpenAI APIキー
 * @returns {Array<{original: string, translation: string, explanation: string}>} 対訳配列
 */
export async function translateLyrics(lines, apiKey) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  // CHUNK_SIZE以下ならそのまま処理
  if (lines.length <= CHUNK_SIZE) {
    return translateChunk(openai, lines);
  }

  // 分割して順次処理
  const totalChunks = Math.ceil(lines.length / CHUNK_SIZE);
  console.log(`    📦 ${lines.length}行を${totalChunks}分割で翻訳します`);

  const allResults = [];

  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const chunk = lines.slice(i, i + CHUNK_SIZE);
    const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
    console.log(`    📦 チャンク ${chunkIndex}/${totalChunks} (${chunk.length}行)`);

    const results = await translateChunk(openai, chunk);
    allResults.push(...results);

    // チャンク間の待機（API制限対策）
    if (i + CHUNK_SIZE < lines.length) {
      await sleep(1000);
    }
  }

  return allResults;
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
        model: "gpt-5-mini",
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
        const inputCost = (usage.prompt_tokens / 1_000_000) * 0.25;
        const outputCost = (usage.completion_tokens / 1_000_000) * 2.0;
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
