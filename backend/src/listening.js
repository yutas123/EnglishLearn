import OpenAI from "openai";
import { sleep, calcCostUsd } from "./translator.js";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 60000;

/**
 * 「聞き取れなかった」とマークされた行について、歌唱時に起こりがちな音声変化
 * （リンキング・脱落・同化など）を一般化して解説する。
 * 実際の音源を聴いて分析しているわけではない（歌詞テキストのみが入力）ため、
 * 「この曲でこう歌われている」という断定ではなく「一般的にこう聞こえやすい」という
 * 推測ベースの解説であることをプロンプト側で明示させる。
 * @param {{ lineOriginal: string, lineTranslation: string }} input
 * @param {string} apiKey
 * @returns {{ explanation: string, costUsd: number }}
 */
export async function explainListeningDifficulty(
  { lineOriginal, lineTranslation },
  apiKey
) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  const prompt = `【英語学習：リスニング困難箇所の解説】

英語学習者が、洋楽の歌詞の以下の行を聴いていて「聞き取れなかった」とマークしました。

行（原文）: "${lineOriginal}"
行の日本語訳: "${lineTranslation}"

この行を歌として歌う際に一般的に起こりやすい音声変化（リンキング/連結、子音の脱落、
同化、機能語の弱形化、縮約など）を推測し、日本語で分かりやすく解説してください。
あなたは実際の音源を聴いているわけではないため、「このアーティストはこう歌っている」
という断定はせず、「歌唱時にはこう聞こえやすい」という一般的な傾向として説明してください。
可能であれば、実際にどう聞こえやすいかをカタカナ等で示してください（例: "want to"→「ワナ」）。
100〜150文字程度で簡潔にまとめてください。

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
              "あなたは英語のリスニング指導をサポートするアシスタントです。歌詞テキストから、歌唱時に起こりやすい音声変化を一般的な傾向として推測し、JSON形式で簡潔に解説してください。",
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
