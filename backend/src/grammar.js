import OpenAI from "openai";
import { sleep, calcCostUsd } from "./translator.js";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 60000;

function formatContext(contextLines) {
  return contextLines
    .map((l) => `${l.isTarget ? "▶" : " "} ${l.original}`)
    .join("\n");
}

function isRetryable(error) {
  const isTimeout = error.code === "ETIMEDOUT" || error.message.includes("timeout");
  return isTimeout || error.status === 429 || error.status >= 500;
}

/**
 * 歌詞1行を文法的に分解して解説する。
 * 歌詞は1文が複数行にまたがることが多いので、前後の行を文脈として渡す（解説対象は▶の行）。
 * @param {{ contextLines: Array<{original: string, isTarget: boolean}>, lineTranslation: string }} input
 * @param {string} apiKey
 * @returns {{ content: {translation: string, skeleton: string, chunks: Array<{text: string, role: string, note: string}>, points: string[]}, costUsd: number }}
 */
export async function explainLineGrammar({ contextLines, lineTranslation }, apiKey) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  const prompt = `【英語学習：歌詞1行の文法分解】

以下は洋楽の歌詞の一部です。▶が付いた行が解説対象で、前後の行は文脈（文が行をまたぐ場合の参考）です。

${formatContext(contextLines)}

▶の行の既存の日本語訳: "${lineTranslation}"

▶の行を、英語学習者（日本語話者）向けに文法的に分解して解説してください。
- translation: 自然な日本語訳（既存訳を参考に、文法構造が分かる訳し方で）
- skeleton: 文の骨格を1〜2文で（主語・動詞・目的語/補語、どこが省略・倒置されているか、前後の行とどう繋がるか）
- chunks: 行を意味のまとまり（句・節）に順に区切った配列。text は原文の該当部分をそのまま（全てのchunkのtextを順に連結すると行全体になること）、role は「主語」「動詞」「目的語」「副詞句」「関係節」「接続詞」等の文法上の役割、note は短い補足（不要なら空文字）
- points: 注意すべき文法ポイント（倒置・省略・仮定法・口語表現・イディオム・時制など）の配列。特になければ空配列

歌詞特有の崩れた文法や口語（ain't, gonna, 主語・助動詞の省略など）は、そう明示して説明してください。
文脈が足りず断定できない部分は、推測であることを明記してください。

以下のJSON形式のみで出力してください：
{"translation": "...", "skeleton": "...", "chunks": [{"text": "...", "role": "...", "note": "..."}], "points": ["..."]}`;

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        reasoning_effort: "low",
        messages: [
          {
            role: "system",
            content:
              "あなたは英文法を日本語で丁寧に解説する英語教師です。洋楽の歌詞を文法的に分解し、指定のJSON形式で出力してください。",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content);
      const costUsd = calcCostUsd(response.usage);

      if (!parsed.skeleton || !Array.isArray(parsed.chunks) || parsed.chunks.length === 0) {
        throw new Error(`予期しないレスポンス形式: ${content.substring(0, 200)}`);
      }

      return {
        content: {
          translation: String(parsed.translation ?? "").trim(),
          skeleton: String(parsed.skeleton).trim(),
          chunks: parsed.chunks.map((c) => ({
            text: String(c.text ?? ""),
            role: String(c.role ?? "").trim(),
            note: String(c.note ?? "").trim(),
          })),
          points: Array.isArray(parsed.points) ? parsed.points.map((p) => String(p).trim()) : [],
        },
        costUsd,
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        await sleep(attempt * 3000);
        continue;
      }
      break;
    }
  }

  throw lastError;
}

/**
 * 文法解説について、学習者の追加質問に答える。
 * @param {{ contextLines: Array<{original: string, isTarget: boolean}>, grammar: object|null, history: Array<{role: string, content: string}>, message: string }} input
 * @param {string} apiKey
 * @returns {{ reply: string, costUsd: number }}
 */
export async function chatAboutLine({ contextLines, grammar, history, message }, apiKey) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  const grammarText = grammar
    ? `【この行の文法解説（学習者が読んでいるもの）】
訳: ${grammar.translation}
骨格: ${grammar.skeleton}
区切り: ${grammar.chunks.map((c) => `[${c.text}]=${c.role}`).join(" / ")}
ポイント: ${grammar.points.join(" / ") || "なし"}`
    : "";

  const system = `あなたは英文法を日本語で丁寧に教える英語教師です。学習者は洋楽の歌詞の1行について文法解説を読み、分からない点を質問しています。
質問には、解説対象の行（▶）を軸に、簡潔に（長くても300文字程度）日本語で答えてください。必要なら短い例文を添えてください。
歌詞特有の崩れた文法や口語は、そうだと明示してください。文脈が足りず断定できないことは推測と明記してください。

【歌詞の文脈】
${formatContext(contextLines)}

${grammarText}`;

  const messages = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        reasoning_effort: "low",
        messages,
      });

      const reply = response.choices[0].message.content?.trim();
      if (!reply) throw new Error("AIの応答が空でした");

      return { reply, costUsd: calcCostUsd(response.usage) };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        await sleep(attempt * 3000);
        continue;
      }
      break;
    }
  }

  throw lastError;
}
