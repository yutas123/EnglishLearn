import OpenAI from "openai";
import { sleep, calcCostUsd } from "./translator.js";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 60000; // 60秒（単発呼び出しなのでチャンク処理より短く）

/**
 * 選択テキストを登録用に整形しつつ、意味・品詞・CEFRをAIで取得。
 * meaningは他の曲でも使い回されるため、この行限定の意訳ではなく一般的な意味を返す
 * （文脈固有のニュアンスは/api/vocab/explainで曲・行単位に別途取得する）。
 * @param {{ term: string, isPhrase: boolean, lineOriginal: string, lineTranslation: string }} input
 * @param {string} apiKey
 * @returns {{ term: string, meaning: string, partOfSpeech: string, cefr: string|null, costUsd: number }}
 */
export async function lemmatizeAndDefine(
  { term, isPhrase, lineOriginal, lineTranslation },
  apiKey
) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  const normalizationInstruction = isPhrase
    ? `これは複数語からなる熟語・イディオムです。文法的な正規化（時制・人称・語順の変更など）は絶対にしないでください。
前後の余分な空白や句読点のトリミングのみ行い、意味を壊さないよう選択された形にできるだけ近い形を"term"として返してください。`
    : `これは単語1つです。"term"には辞書の見出し語形（原形・単数形など）を返してください（例: "gave"→"give", "running"→"run"）。`;

  const prompt = `【英語学習：単語帳登録用の情報抽出】

以下は歌詞から学習者が選択した表現です。この表現について情報を抽出してください。

選択された表現: "${term}"
含まれていた行（原文）: "${lineOriginal}"
その行の日本語訳: "${lineTranslation}"

${normalizationInstruction}

この表現はこの曲以外の歌詞でも同じ語として単語帳に登録され、他の曲では別の文脈で使われます。
"meaning"には、この行だけの意訳ではなく、辞書に載っているような、どの文脈でも通用する一般的な意味を書いてください
（例:「every time」なら「〜するたびに（いつも）」のように、文脈に依存しない基本義）。

以下のJSON形式で出力してください（必ずこの形式を守ってください）：
{
  "term": "登録用の表記",
  "meaning": "一般的な(辞書的な)日本語の意味（簡潔に、文脈依存の意訳は避ける）",
  "partOfSpeech": "品詞（熟語・イディオムの場合は「イディオム」）",
  "cefr": "A1〜C2のいずれか（判断が難しい場合はnull）"
}`;

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content:
              "あなたは英語学習をサポートする辞書アシスタントです。学習者が選択した単語・熟語について、文脈に即した簡潔な情報をJSON形式で提供してください。",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content);
      const costUsd = calcCostUsd(response.usage);

      if (!parsed.term || !parsed.meaning) {
        throw new Error(`予期しないレスポンス形式: ${content.substring(0, 200)}`);
      }

      return {
        term: String(parsed.term).trim(),
        meaning: String(parsed.meaning).trim(),
        partOfSpeech: parsed.partOfSpeech ? String(parsed.partOfSpeech).trim() : null,
        cefr: parsed.cefr ? String(parsed.cefr).trim() : null,
        costUsd,
      };
    } catch (error) {
      lastError = error;
      const isTimeout = error.code === "ETIMEDOUT" || error.message.includes("timeout");
      const isRetryable = isTimeout || error.status === 429 || error.status >= 500;

      if (attempt < MAX_RETRIES && isRetryable) {
        await sleep(attempt * 3000);
        continue;
      }
      break;
    }
  }

  throw lastError;
}

/**
 * 選択された表現が、その行の対訳になぜ繋がるのかをAIで解説
 * @param {{ selectedText: string, lineOriginal: string, lineTranslation: string }} input
 * @param {string} apiKey
 * @returns {{ explanation: string, costUsd: number }}
 */
export async function explainSpan(
  { selectedText, lineOriginal, lineTranslation },
  apiKey
) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  const prompt = `【英語学習：表現解説】

英語学習者が、以下の行の中から一部を選択し「なぜこの訳になるのか」を知りたがっています。

行全体（原文）: "${lineOriginal}"
行全体の日本語訳: "${lineTranslation}"
学習者が選択した箇所: "${selectedText}"

選択箇所が、行全体の訳にどう繋がっているかを解説してください。
熟語・イディオム・倒置・省略・スラングなど、単語を知っていても意味が推測しにくい理由がある場合はそれを中心に、
分かりやすく日本語で説明してください（100〜150文字程度）。

以下のJSON形式で出力してください：
{"explanation": "解説文"}`;

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content:
              "あなたは英語学習をサポートする解説アシスタントです。学習者が理解できなかった表現について、簡潔で分かりやすい解説をJSON形式で提供してください。",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content);
      const costUsd = calcCostUsd(response.usage);

      if (!parsed.explanation) {
        throw new Error(`予期しないレスポンス形式: ${content.substring(0, 200)}`);
      }

      return { explanation: String(parsed.explanation).trim(), costUsd };
    } catch (error) {
      lastError = error;
      const isTimeout = error.code === "ETIMEDOUT" || error.message.includes("timeout");
      const isRetryable = isTimeout || error.status === 429 || error.status >= 500;

      if (attempt < MAX_RETRIES && isRetryable) {
        await sleep(attempt * 3000);
        continue;
      }
      break;
    }
  }

  throw lastError;
}
