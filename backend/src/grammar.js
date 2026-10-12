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

▶の行を含む文全体の既存の日本語訳（参考。複数行にまたがる文なら全体の訳）: "${lineTranslation}"

ユーザーは洋楽の歌詞を精読しています。答えだけでなく「なぜそう読めるか」を、文の構造と文法の根拠から説明してください。
扱う文法事項は限定せず、その文の理解に必要なものはすべて解説対象とします。

## 解説の手順（この順に確認し、該当するものだけ説明する）
1. 文の区切り：改行は文の区切りではない。動詞に必要な要素がそろい、付属する修飾語を含むところまでを一文とする。複数行にまたがる場合は明示する。
2. 語順の復元：疑問文・倒置・命令文・省略（主語、be動詞、関係詞、接続詞など）は、普通の語順と省略前の形に戻して示す。
3. 骨格：述語動詞を特定し、自動詞か他動詞か、何を必要とするかを確認したうえで、S・V・O・C・M と文型を示す。
4. カタマリ：句・節（不定詞、動名詞、分詞、分詞構文、関係詞、接続詞の節、名詞節、形式主語、同格など）を特定し、働きと範囲を示す。入れ子になっている場合は内側の構造も示す。
5. 動詞の形：時制、進行形、完了形、受動態、助動詞、仮定法、命令などを特定し、それが表す時間関係や話し手の気持ち（後悔、願望、推量など）を説明する。
6. その他の構文：比較、否定（二重否定・部分否定を含む）、強調構文、倒置による強調など、意味に影響するものを指摘する。
7. 品詞と位置のチェック：知っていそうな単語が、その位置では別の品詞・用法になっている場合は必ず指摘し、その用法の意味を示す。
8. 語彙のまとまり：句動詞、イディオム、コロケーション、口語・スラング、文法を崩した表現（ain't、gonna など）は、まとまりとしての意味を示す。
9. 文脈：指示語が何を指すか、比喩や言葉遊び、文脈で変わるニュアンスを説明する。前後の行を根拠にし、断定できない場合は候補として示し、推測であることを明記する。

## 出力ルール
- 用語は学校文法の用語（S・V・O・C・M、第○文型、名詞的用法、現在完了など）を使い、初出の用語には短い説明を添える。
- 簡単な行は短く、難しい行ほど詳しく。手順の全項目を機械的に埋めなくてよい。
- 文法的に誤っている・崩れている箇所は、正規の形と比べてどう崩れているかを示す。
- 歌詞の全文を書き写さない。chunks の text 以外では、引用は説明に必要な最小限の語句にとどめる。

## JSONの各項目への割り当て
- translation: 構造が分かる自然な日本語訳（既存訳を参考にしてよい）
- skeleton: 手順1〜3の結果（文の区切り、省略・倒置の復元形、述語動詞とS・V・O・C・M・文型、前後の行との繋がり）を簡潔に
- chunks: ▶の行だけを、意味のまとまり（句・節）に順に区切った配列（手順4）。入れ子にせず、重複させず、前後の行は含めない（text は原文の該当部分をそのまま。全てのchunkのtextを順に連結すると▶の行そのものになること）。内側の構造は note か points で説明する。role は「主語」「動詞」「目的語」「関係節」「副詞句」等の文法上の役割、note は短い補足（不要なら空文字）
- points: 手順5〜9で該当したもののうち、この行の理解に特に重要なものを最大5個、重要な順に（1項目1ポイント）。skeleton や chunks の note と重複する内容は書かない。「手順3」のような手順番号は書かない。特になければ空配列

以下のJSON形式のみで出力してください：
{"translation": "...", "skeleton": "...", "chunks": [{"text": "...", "role": "...", "note": "..."}], "points": ["..."]}`;

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        reasoning_effort: "medium",
        messages: [
          {
            role: "system",
            content:
              "あなたは日本語話者向けの英文読解講師です。洋楽の歌詞を、文の構造と文法の根拠から「なぜそう読めるか」まで説明し、指定のJSON形式で出力してください。",
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
