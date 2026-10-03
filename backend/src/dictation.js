import OpenAI from "openai";
import { sleep, calcCostUsd } from "./translator.js";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 60000;

/** 文法面の判定：直せた / 文法では決められない / 歌詞が標準文法を崩している */
export const GRAMMAR_LEVELS = ["fixable", "undecidable", "nonstandard"];

/** 自己申告の「聞き取れなかった」記号（?? や ？？ など） */
const GAP_RE = /^[?？]+$/;

/**
 * 比較用に正規化する。小文字化、アポストロフィ類の除去（didn't と didnt を同一視）、英数字以外の除去。
 */
function normalizeWord(raw) {
  return raw
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9À-ɏ]/g, "");
}

/** 空白・ハイフン・ダッシュで単語に分割する */
function splitWords(text) {
  return text.split(/[\s‐-―-]+/).filter(Boolean);
}

/**
 * 歌詞1行を単語に分割し、各語がカッコ内（コーラスや合いの手）かどうかを判定する。
 * カッコ内の語は「書かなくても減点しない（書いていれば一致として数える）」任意の語として扱う。
 * カッコの対応は行ごとに数え直す（片側だけ閉じ忘れたカッコが後続の行に影響しないようにする）。
 */
function tokenizeRefLine(text) {
  const tokens = [];
  let depth = 0;
  for (const raw of splitWords(text)) {
    const opens = (raw.match(/[(（]/g) ?? []).length;
    const closes = (raw.match(/[)）]/g) ?? []).length;
    tokens.push({ raw, optional: depth > 0 || opens > 0 });
    depth = Math.max(0, depth + opens - closes);
  }
  return tokens;
}

/** Damerau-Levenshtein（隣接文字の入れ替えを1手と数える）距離 */
export function editDistance(a, b) {
  const n = a.length;
  const m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

/**
 * 置換（ref と user が異なる語）の種類を判定する。
 *  - form: 語形のずれ（talk/talks/talked のように語幹が同じで語尾だけ違う）
 *  - spelling: 綴りミス（編集距離が小さい）
 *  - misheard: 別の語として聞き取っている
 */
export function classifySubstitution(ref, user) {
  const prefixLen = (() => {
    let k = 0;
    while (k < ref.length && k < user.length && ref[k] === user[k]) k++;
    return k;
  })();
  const shorter = Math.min(ref.length, user.length);
  const refTail = ref.length - prefixLen;
  const userTail = user.length - prefixLen;
  if (prefixLen >= 3 && prefixLen >= shorter - 1 && refTail <= 3 && userTail <= 3) {
    return "form";
  }

  const dist = editDistance(ref, user);
  const longer = Math.max(ref.length, user.length);
  if (longer >= 5 && dist <= 2 && dist / longer <= 0.34) {
    return "spelling";
  }
  return "misheard";
}

/** 置換コスト（0〜1）。似ているほど小さくして、別語の置換より優先的に対応づける */
function substitutionCost(refWord, userWord) {
  if (refWord === userWord) return 0;
  if (userWord === null) return 0.3; // ?? は何の語にも対応しうる
  const dist = editDistance(refWord, userWord);
  const longer = Math.max(refWord.length, userWord.length);
  return Math.min(1, 0.4 + 0.6 * (dist / longer));
}

/**
 * ユーザーの書き取りを歌詞と単語単位でアラインメントして採点する。
 * 行区切りは無視し、全体を1本の単語列として対応づける（行頭・行末が歌詞とずれていてもよい）。
 * ユーザーが途中までしか書いていない場合を考慮し、先頭・末尾の歌詞側の未対応は無コストにしている。
 *
 * @param {{ lineIndex: number, original: string }[]} refLines 歌詞（表示順）
 * @param {string} userText ユーザーが書いたテキスト
 */
export function evaluateDictation(refLines, userText) {
  // 歌詞側を単語列に展開
  const ref = [];
  for (const line of refLines) {
    for (const { raw, optional } of tokenizeRefLine(line.original)) {
      const norm = normalizeWord(raw);
      if (norm) ref.push({ lineIndex: line.lineIndex, raw, norm, optional });
    }
  }

  // ユーザー側を単語列に展開（?? は norm=null のギャップ印）
  const user = [];
  for (const raw of splitWords(userText)) {
    if (GAP_RE.test(raw)) {
      user.push({ raw: "??", norm: null });
      continue;
    }
    const norm = normalizeWord(raw);
    if (norm) user.push({ raw, norm });
  }

  const n = ref.length;
  const m = user.length;

  // 歌詞i語目とユーザーj語目を対応づけるコスト。任意の語（カッコ内）は、ほぼ同じ語を書いたときだけ対応づけ、
  // ?? や似ていない語は吸収しない（無関係な語を聞き違いとして誤って対応づけないため）
  const subCostAt = (i, j) => {
    const cost = substitutionCost(ref[i].norm, user[j].norm);
    if (ref[i].optional && cost > 0.6) return Infinity;
    return cost;
  };
  // 歌詞の語をユーザーが書いていないコスト。任意の語は書かなくても減点しない
  const delCostAt = (i) => (ref[i].optional ? 0 : 1);

  // dp[i][j]: 歌詞i語・ユーザーj語までの最小コスト。歌詞先頭の読み飛ばしは無コスト
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let j = 1; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    dp[i][0] = 0;
    for (let j = 1; j <= m; j++) {
      const sub = dp[i - 1][j - 1] + subCostAt(i - 1, j - 1);
      const del = dp[i - 1][j] + delCostAt(i - 1); // 歌詞の語をユーザーが書いていない
      const ins = dp[i][j - 1] + 1; // ユーザーが余計な語を書いた
      dp[i][j] = Math.min(sub, del, ins);
    }
  }

  // 歌詞末尾の読み飛ばしも無コスト：最小になる終端 i を選ぶ
  let endI = 0;
  for (let i = 1; i <= n; i++) {
    if (dp[i][m] < dp[endI][m]) endI = i;
  }

  // トレースバック: ops は歌詞側・ユーザー側の添字（無い側は -1）
  const ops = [];
  let i = endI;
  let j = m;
  while (j > 0 || (i > 0 && dp[i][j] > 0)) {
    if (i > 0 && j > 0) {
      const sub = dp[i - 1][j - 1] + subCostAt(i - 1, j - 1);
      if (Number.isFinite(sub) && Math.abs(dp[i][j] - sub) < 1e-9) {
        ops.push({ r: i - 1, u: j - 1 });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + delCostAt(i - 1))) < 1e-9) {
      ops.push({ r: i - 1, u: -1 });
      i--;
      continue;
    }
    if (j > 0) {
      ops.push({ r: -1, u: j - 1 });
      j--;
      continue;
    }
    break;
  }
  ops.reverse();

  // 歌詞の各語に対応するユーザーの語と、行ごとの余分な語を集める
  const matchOfRef = new Array(n).fill(-1); // 歌詞i語目に対応したユーザー添字（-1=未対応）
  const extrasByRefIndex = new Map(); // 余分な語を、直前の歌詞語の位置に紐付ける
  let lastRef = -1;
  for (const op of ops) {
    if (op.r >= 0) {
      matchOfRef[op.r] = op.u;
      lastRef = op.r;
    } else {
      const key = lastRef;
      if (!extrasByRefIndex.has(key)) extrasByRefIndex.set(key, []);
      extrasByRefIndex.get(key).push(user[op.u].raw);
    }
  }

  // 対応づけられた範囲の外にある「丸ごと未入力の行」は採点対象から外す
  const aligned = ops.filter((op) => op.r >= 0 && op.u >= 0);
  const firstLine = aligned.length ? ref[aligned[0].r].lineIndex : null;
  const lastLine = aligned.length ? ref[aligned[aligned.length - 1].r].lineIndex : null;
  const isSkippedLine = (lineIndex) =>
    firstLine === null || lineIndex < firstLine || lineIndex > lastLine;

  // 歌詞語ごとのステータスを決定
  const items = ref.map((w, idx) => {
    const u = matchOfRef[idx];
    if (u < 0) {
      // 任意の語（カッコ内）は、書かれていなくても脱落とは数えない
      return {
        lineIndex: w.lineIndex,
        ref: w.raw,
        user: null,
        status: w.optional ? "optional" : "missing",
      };
    }
    const uw = user[u];
    if (uw.norm === null) {
      return { lineIndex: w.lineIndex, ref: w.raw, user: "??", status: "gap" };
    }
    if (uw.norm === w.norm) {
      return { lineIndex: w.lineIndex, ref: w.raw, user: uw.raw, status: "match" };
    }
    return {
      lineIndex: w.lineIndex,
      ref: w.raw,
      user: uw.raw,
      status: classifySubstitution(w.norm, uw.norm),
    };
  });

  // ?? の直後で歌詞側だけ余っている語（1つの ?? で複数語を表した場合）は、脱落ではなく自己申告扱い
  for (let idx = 1; idx < n; idx++) {
    if (
      items[idx].status === "missing" &&
      items[idx - 1].status === "gap" &&
      !isSkippedLine(items[idx].lineIndex)
    ) {
      items[idx].status = "gap";
      items[idx].user = "??";
    }
  }

  // 行ごとにまとめる
  const lines = [];
  const lineMap = new Map();
  for (const line of refLines) {
    const entry = { lineIndex: line.lineIndex, skipped: isSkippedLine(line.lineIndex), items: [] };
    lineMap.set(line.lineIndex, entry);
    lines.push(entry);
  }
  items.forEach((item, idx) => {
    const entry = lineMap.get(item.lineIndex);
    const { lineIndex: _lineIndex, ...rest } = item;
    entry.items.push({ ...rest, extrasAfter: extrasByRefIndex.get(idx) ?? [] });
  });
  // 歌詞の最初の語より前に書かれた余分な語は先頭行に付ける
  const leadingExtras = extrasByRefIndex.get(-1);
  if (leadingExtras && lines.length > 0) {
    lines[0].leadingExtras = leadingExtras;
  }

  // 集計（スキップ行は除外）
  const counts = { match: 0, misheard: 0, missing: 0, spelling: 0, form: 0, gap: 0 };
  let total = 0;
  for (const line of lines) {
    if (line.skipped) continue;
    for (const item of line.items) {
      if (item.status === "optional") continue; // 書かれていない任意の語は採点対象外
      counts[item.status] += 1;
      total += 1;
    }
  }
  const extra = ops.filter((op) => op.r < 0).length;
  const gapMarks = user.filter((w) => w.norm === null).length;
  const accuracy = total > 0 ? counts.match / total : 0;

  return { lines, summary: { total, counts, extra, gapMarks, accuracy } };
}

/**
 * 区間（連続した数行のまとまり）ごとに入力された書き取りを、それぞれ対応する歌詞の区間とだけ照合して採点する（再挑戦用）。
 * 区間と入力の対応が分かっているので、全体を通した書き取りと違い、区間をまたぐ対応づけのずれは起きない。
 * 区間の中では行区切りを無視して単語列として対応づける（歌い手の息継ぎと歌詞の改行は一致しないため）。
 * 入力が空の区間は呼び出し側で除外しておくこと。
 *
 * @param {{ lines: { lineIndex: number, original: string }[], text: string }[]} groups
 */
export function evaluateDictationGroups(groups) {
  const lines = [];
  const counts = { match: 0, misheard: 0, missing: 0, spelling: 0, form: 0, gap: 0 };
  let total = 0;
  let extra = 0;
  let gapMarks = 0;

  for (const group of groups) {
    const { lines: evaluated, summary } = evaluateDictation(group.lines, group.text);
    lines.push(...evaluated);
    for (const key of Object.keys(counts)) counts[key] += summary.counts[key];
    total += summary.total;
    extra += summary.extra;
    gapMarks += summary.gapMarks;
  }

  const accuracy = total > 0 ? counts.match / total : 0;
  return { lines, summary: { total, counts, extra, gapMarks, accuracy } };
}

/**
 * 書き取りで間違えた行について、聞き違いの原因を日本語で解説する。
 * 実際の音源は聴いていないので、歌唱時に一般的に起きやすい音声変化としての推測であることを明示させる。
 * @param {{ lineOriginal: string, lineTranslation: string, mistakes: { ref: string, user: string|null, status: string }[] }} input
 * @param {string} apiKey
 * @returns {{ explanation: string, grammar: { word: string, level: string, note: string }[], costUsd: number }}
 */
export async function explainDictationMistake(
  { lineOriginal, lineTranslation, mistakes },
  apiKey
) {
  const openai = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  const statusLabel = {
    misheard: "別の語に聞き違え",
    missing: "書き取れず（脱落）",
    gap: "聞き取れず（?? と記入）",
    spelling: "綴りミス",
    form: "語形のずれ（語尾など）",
  };
  const mistakeText = mistakes
    .map(
      (m) =>
        `- 正解 "${m.ref}" → 学習者の記入 ${m.user ? `"${m.user}"` : "（なし）"}（${
          statusLabel[m.status] ?? m.status
        }）`
    )
    .join("\n");

  const prompt = `【英語学習：書き取り（ディクテーション）の誤り解説】

英語学習者が、洋楽の歌詞を聴いて書き取りをしました。以下の行で間違いがありました。

行（正解の原文）: "${lineOriginal}"
行の日本語訳: "${lineTranslation}"

間違えた語:
${mistakeText}

次の2つを日本語で出力してください。

1. sound: なぜそう聞こえた／書いてしまったのかの解説
- 聞き違い・聞き取れなかった語は、歌唱時に一般的に起こりやすい音声変化（連結、脱落、同化、弱形化など）をカタカナ等で示して説明する
- 綴りミスは正しい綴りと覚え方のコツを説明する
- あなたは実際の音源を聴いていないため、「このアーティストはこう歌っている」と断定せず、「歌唱時にはこう聞こえやすい」という一般的な傾向として説明する
- 100〜160文字程度で簡潔に

2. grammar: 間違えた語ごとの文法面の判定（綴りミスの語は含めない）
各語について、学習者が文法の知識から正解にたどり着けたかを次の3段階で判定する。
- "fixable"（文法で直せた）: 主語と動詞の一致、時制、be動詞、助動詞、冠詞、前置詞などの標準的な文法から、正解を推測できた
- "undecidable"（文法では決められない）: 語彙や音の問題で、文法は手がかりにならない
- "nonstandard"（歌詞が崩している）: 口語・省略・倒置・ain't・二重否定など、歌詞があえて標準文法から外れている
note は、その語の品詞や文中の役割（主語・目的語・補語・助動詞・前置詞・修飾語・冠詞など）に触れる1文（50文字以内）にする。文法規則の長い説明や例文は書かない。
"nonstandard" の場合は、どう崩れているかを note に明記する。

以下のJSON形式で出力してください：
{"sound": "音の解説文", "grammar": [{"word": "正解の語", "level": "fixable|undecidable|nonstandard", "note": "文法メモ"}]}`;

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
              "あなたは英語のリスニング・ディクテーション指導をサポートするアシスタントです。学習者の誤りの原因を、推測であることを明示しながらJSON形式で簡潔に解説してください。",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content);
      const costUsd = calcCostUsd(response.usage);

      if (!parsed.sound) {
        throw new Error(`予期しないレスポンス形式: ${content.substring(0, 200)}`);
      }

      const grammar = (Array.isArray(parsed.grammar) ? parsed.grammar : [])
        .filter((g) => g && GRAMMAR_LEVELS.includes(g.level) && g.word)
        .map((g) => ({
          word: String(g.word).trim(),
          level: g.level,
          note: String(g.note ?? "").trim(),
        }));

      return { explanation: String(parsed.sound).trim(), grammar, costUsd };
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
