"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { KnownSpan, MatchSpan } from "@/lib/vocabMatcher";
import { sameTrackTitle } from "@/lib/trackTitle";
import {
  MEMBERS,
  voiceToken,
  voiceUnderlineStyle,
  underlineTotal,
  applySongOrder,
  sortVoices,
  applyParenVoices,
  roleLabel,
  DEFAULT_ORDER,
  type MemberKey,
  type VoicePart,
  type VocalSource,
  type Voice,
} from "@/lib/beatles";
import VocalEditor, { type VocalScope } from "./VocalEditor";
import { VOCAL_EDIT_EVENT } from "./VocalEditToggle";

// 行の線の構成を保存形式にする（1パートなら行全体の配列、複数パートなら parts 形式）
const serializeParts = (p: VoicePart[]) =>
  p.length === 1
    ? p[0].voices.map(voiceToken)
    : { parts: p.map((x) => ({ end: x.end, v: x.voices.map(voiceToken) })) };

// 曲全体への一括適用で、人ごとに何をするか（変更しない／濃い線・ユニゾン・ダブルを設定／全行から削除）
type BulkMode = "keep" | "set" | "remove";
type BulkSetting = { mode: BulkMode; role: Voice["role"]; double: boolean; add: boolean };
const bulkDefaults = (): Record<MemberKey, BulkSetting> => ({
  john: { mode: "keep", role: "L", double: false, add: false },
  paul: { mode: "keep", role: "L", double: false, add: false },
  george: { mode: "keep", role: "L", double: false, add: false },
  ringo: { mode: "keep", role: "L", double: false, add: false },
});
// かっこ書き（コーラス）の一括設定。on の人だけがかっこの中を歌う
type ParenSetting = { on: boolean; role: Voice["role"]; double: boolean };
const parenDefaults = (): Record<MemberKey, ParenSetting> => ({
  john: { on: false, role: "L", double: false },
  paul: { on: false, role: "L", double: false },
  george: { on: false, role: "L", double: false },
  ringo: { on: false, role: "L", double: false },
});
// 例：Boys 型。トップはポールのハモリ、ミドル・ボトムはジョンとジョージのユニゾン
const parenBoysPreset = (): Record<MemberKey, ParenSetting> => ({
  ...parenDefaults(),
  paul: { on: true, role: "L", double: false },
  george: { on: true, role: "H", double: false },
  john: { on: true, role: "H", double: false },
});
import { KNOWN_TITLE_CLICK_EVENT, type KnownTitleClickDetail } from "./TrackTitle";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type Line = {
  id: string;
  lineIndex: number;
  original: string;
  translation: string;
  sentenceStart: number | null;
  explanation: string | null;
  sectionLabel: string | null;
  knownSpans: KnownSpan[];
  hardSpans: MatchSpan[];
  // ビートルズ曲のみ。この行を歌っている人（音程の高い順）を、行内の部分ごとに持つ。空なら下線を出さない
  parts?: VoicePart[];
  // 画面で編集した上書きを消したとき（初期値に戻す）に戻る、セクション指定ベースの線
  defaultParts?: VoicePart[];
};

// マーカー層（背景色）
type TaggedSpan =
  | (MatchSpan & { kind: "hard" })
  | (KnownSpan & { kind: "known" });

// ドラッグ選択で新規に選んだ範囲か、既存の登録済みマーカーをクリックしたのかを区別する
type Selection = {
  lineIndex: number;
  original: string;
  text: string;
  isPhrase: boolean;
  rect: DOMRect;
  existingVocabEntryId?: string;
};

type PopupState =
  | { mode: "menu" }
  | {
      mode: "loading";
      action: "explain" | "preview" | "register" | "delete";
    }
  | { mode: "explanation"; text: string }
  | {
      mode: "confirm";
      term: string;
      meaning: string;
      partOfSpeech: string | null;
      cefr: string | null;
      ipa: string | null;
      explanation: string | null;
      isExisting: boolean;
      // 複数語選択で「まとまりで覚える価値が低い」と判定されたときの、鍵となる1語
      coreWord: string | null;
    }
  | {
      mode: "registered";
      meaning: string;
      partOfSpeech: string | null;
      cefr: string | null;
      ipa: string | null;
    }
  | {
      mode: "viewEntry";
      vocabEntryId: string;
      term: string;
      meaning: string;
      partOfSpeech: string | null;
      cefr: string | null;
      ipa: string | null;
      explanation: string | null;
      isOriginTrack: boolean;
      knownSpan: KnownSpan;
    }
  | { mode: "error"; message: string };

/**
 * 原文にマーカー（背景色）を重ねて描画する（dangerouslySetInnerHTMLは使わない）。
 * 既知語（known）と難所（hard）。重なる場合はknownを優先
 */
function renderWithHighlights(
  text: string,
  knownSpans: KnownSpan[],
  hardSpans: MatchSpan[],
  onKnownClick: (span: KnownSpan, el: HTMLElement, matchedText: string) => void
) {
  const tagged: TaggedSpan[] = [
    ...knownSpans.map((s) => ({ ...s, kind: "known" as const })),
    ...hardSpans.map((s) => ({ ...s, kind: "hard" as const })),
  ].sort((a, b) => a.start - b.start);

  const markers: TaggedSpan[] = [];
  let markerCoveredUntil = 0;
  for (const span of tagged) {
    if (span.start < markerCoveredUntil) continue; // 既存スパンと重なる場合はスキップ
    markers.push(span);
    markerCoveredUntil = span.end;
  }

  if (markers.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  markers.forEach((marker, i) => {
    const start = Math.max(0, Math.min(text.length, marker.start));
    const end = Math.max(0, Math.min(text.length, marker.end));
    if (start > cursor) parts.push(text.slice(cursor, start));
    const body = text.slice(start, end);

    if (marker.kind === "known") {
      parts.push(
        <mark
          key={i}
          className="cursor-pointer rounded bg-emerald-100 px-0.5 text-inherit hover:bg-emerald-200"
          title="登録済み（タップで詳細）"
          onClick={(e) => {
            e.stopPropagation();
            onKnownClick(marker, e.currentTarget, body);
          }}
        >
          {body}
        </mark>
      );
    } else {
      parts.push(
        <mark
          key={i}
          className="rounded bg-sky-100 px-0.5 text-inherit underline decoration-dotted decoration-sky-400"
          title="難所（要チェック）"
        >
          {body}
        </mark>
      );
    }
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return parts;
}

function normalize(s: string) {
  return s.toLowerCase().trim();
}

export default function LyricsList({
  trackId,
  lines,
  title,
  artistName,
  canEditVocals = false,
  initialSongOrder = null,
  initialSources = [],
}: {
  trackId: string;
  lines: Line[];
  title: string;
  artistName: string;
  canEditVocals?: boolean;
  // 曲全体の線の並び順（上から）。設定されていれば、全ての行でこの順に線を並べる
  initialSongOrder?: MemberKey[] | null;
  // 曲全体で「この資料を確認した」と記録した資料の一覧
  initialSources?: VocalSource[];
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [popup, setPopup] = useState<PopupState>({ mode: "menu" });
  const [lastExplanation, setLastExplanation] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [contextNote, setContextNote] = useState<{ loading: boolean; text: string | null }>({
    loading: false,
    text: null,
  });
  const [currentSectionLabel, setCurrentSectionLabel] = useState<string | null>(null);
  const [flashLineIndex, setFlashLineIndex] = useState<number | null>(null);

  // 歌詞の下線の編集モード。保存した内容をすぐ画面に反映するため、行ごとの上書きをローカルにも持つ
  // （値がnullの行は「上書きを消して初期値に戻した」状態）
  const [vocalEditMode, setVocalEditMode] = useState(false);
  const [editingVocalIndex, setEditingVocalIndex] = useState<number | null>(null);
  const [localVoices, setLocalVoices] = useState<Record<number, VoicePart[] | null>>({});
  const [vocalSaving, setVocalSaving] = useState(false);
  const [vocalError, setVocalError] = useState<string | null>(null);

  // ヘッダーの編集アイコン（VocalEditToggle）からの切り替えを受け取る
  useEffect(() => {
    if (!canEditVocals) return;
    const onToggle = (e: Event) => {
      setVocalEditMode(Boolean((e as CustomEvent<{ on: boolean }>).detail?.on));
      setEditingVocalIndex(null);
    };
    window.addEventListener(VOCAL_EDIT_EVENT, onToggle);
    return () => window.removeEventListener(VOCAL_EDIT_EVENT, onToggle);
  }, [canEditVocals]);

  const [songOrder, setSongOrder] = useState<MemberKey[] | null>(initialSongOrder);
  const [orderSaving, setOrderSaving] = useState(false);

  // 曲全体への一括適用（押した時点で全行の保存データを書き換える）
  const [bulk, setBulk] = useState(bulkDefaults);
  const [bulkOrder, setBulkOrder] = useState<MemberKey[]>(DEFAULT_ORDER);
  const [bulkOrderTouched, setBulkOrderTouched] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  // かっこ書き（コーラス）の一括設定。onの人が、かっこの中の歌い手になる（上から順は parenOrder）
  const [paren, setParen] = useState(parenDefaults);
  const [parenOrder, setParenOrder] = useState<MemberKey[]>(DEFAULT_ORDER);
  const [parenConfirm, setParenConfirm] = useState(false);

  // 確認した資料。保存済み（sources）は緑で一覧表示し、入力欄（sourcesDraft）は新規分だけ。保存すると追記される
  const [sources, setSources] = useState<VocalSource[]>(initialSources);
  const [sourcesDraft, setSourcesDraft] = useState<VocalSource[]>([]);
  const [sourcesEditing, setSourcesEditing] = useState(false);
  const [sourcesSaving, setSourcesSaving] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  async function postSources(body: { addSources?: VocalSource[]; removeSource?: string }): Promise<boolean> {
    setSourcesSaving(true);
    setSourcesError(null);
    try {
      const res = await fetch(`/api/tracks/${trackId}/vocals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "保存に失敗しました");
      setSources(data.sources ?? []);
      return true;
    } catch (err) {
      setSourcesError(err instanceof Error ? err.message : "保存に失敗しました");
      return false;
    } finally {
      setSourcesSaving(false);
    }
  }
  async function saveSources() {
    const added = sourcesDraft
      .map((r) => ({ url: r.url.trim(), note: r.note.trim() }))
      .filter((r) => r.url !== "");
    if (added.length > 0 && !(await postSources({ addSources: added }))) return;
    setSourcesDraft([]);
    setSourcesEditing(false);
  }
  const updateSourceDraft = (i: number, patch: Partial<VocalSource>) =>
    setSourcesDraft((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const partsFor = (line: Line): VoicePart[] => {
    const parts = (line.lineIndex in localVoices
      ? (localVoices[line.lineIndex] ?? line.defaultParts)
      : line.parts) ?? [{ end: line.original.length, voices: [] }];
    return songOrder ? applySongOrder(parts, songOrder) : parts;
  };

  // 曲全体の線の並び順を保存する（null で解除して行ごとの指定に戻す）
  async function saveSongOrder(order: MemberKey[] | null) {
    setOrderSaving(true);
    setVocalError(null);
    try {
      const res = await fetch(`/api/tracks/${trackId}/vocals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error ?? "保存に失敗しました");
      }
      setSongOrder(order);
      // 解除すると、サーバー側で並べ直した初期値を取り直す必要がある
      if (!order) window.location.reload();
    } catch (err) {
      setVocalError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setOrderSaving(false);
    }
  }
  const updateBulk = (m: MemberKey, patch: Partial<BulkSetting>) => {
    setBulk((prev) => ({ ...prev, [m]: { ...prev[m], ...patch } }));
    setBulkConfirm(false);
    setBulkMessage(null);
  };
  const moveBulkOrder = (i: number, d: number) => {
    setBulkOrder((prev) => {
      const next = [...prev];
      const t = i + d;
      if (t < 0 || t >= next.length) return prev;
      [next[i], next[t]] = [next[t], next[i]];
      return next;
    });
    setBulkOrderTouched(true);
    setBulkConfirm(false);
    setBulkMessage(null);
  };
  const bulkHasWork = bulkOrderTouched || bulkOrder.some((m) => bulk[m].mode !== "keep");

  // 1行ぶんの線の構成に、一括適用の指定を反映する
  function applyBulkToParts(parts: VoicePart[]): VoicePart[] {
    return parts.map((p) => {
      let voices: Voice[] = p.voices
        .filter((v) => bulk[v.member].mode !== "remove")
        .map((v) =>
          bulk[v.member].mode === "set" ? { ...v, role: bulk[v.member].role, double: bulk[v.member].double } : v
        );
      for (const m of bulkOrder) {
        const b = bulk[m];
        if (b.mode === "set" && b.add && !voices.some((v) => v.member === m)) {
          voices = [...voices, { member: m, role: b.role, double: b.double }];
        }
      }
      if (bulkOrderTouched) voices = sortVoices(voices, bulkOrder);
      return { ...p, voices };
    });
  }

  // 変わる行だけを保存データにして返す
  function planBulk() {
    const plan: { line: Line; next: VoicePart[] }[] = [];
    for (const line of lines) {
      const current = partsFor(line);
      const next = applyBulkToParts(current);
      if (JSON.stringify(serializeParts(next)) !== JSON.stringify(serializeParts(current))) {
        plan.push({ line, next });
      }
    }
    return plan;
  }

  // かっこ書き（コーラス）の部分だけを、指定した歌い手に差し替える計画
  function planParen() {
    const voices = parenOrder
      .filter((m) => paren[m].on)
      .map((m): Voice => ({ member: m, role: paren[m].role, double: paren[m].double }));
    const plan: { line: Line; next: VoicePart[] }[] = [];
    for (const line of lines) {
      const current = partsFor(line);
      const next = applyParenVoices(current, line.original, voices);
      if (JSON.stringify(serializeParts(next)) !== JSON.stringify(serializeParts(current))) {
        plan.push({ line, next });
      }
    }
    return plan;
  }
  const updateParen = (m: MemberKey, patch: Partial<ParenSetting>) => {
    setParen((prev) => ({ ...prev, [m]: { ...prev[m], ...patch } }));
    setBulkConfirm(false);
    setBulkMessage(null);
  };
  const moveParenOrder = (i: number, d: number) => {
    setParenOrder((prev) => {
      const next = [...prev];
      const t = i + d;
      if (t < 0 || t >= next.length) return prev;
      [next[i], next[t]] = [next[t], next[i]];
      return next;
    });
    setParenConfirm(false);
    setBulkMessage(null);
  };

  async function runBulk(kind: "all" | "paren" = "all") {
    const plan = kind === "paren" ? planParen() : planBulk();
    if (plan.length === 0) {
      setBulkMessage("書き換える行はありませんでした");
      setBulkConfirm(false);
      setParenConfirm(false);
      return;
    }
    setBulkSaving(true);
    setVocalError(null);
    try {
      const res = await fetch(`/api/tracks/${trackId}/vocals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: Object.fromEntries(plan.map(({ line, next }) => [String(line.lineIndex), serializeParts(next)])),
          // 旧「曲全体の並び固定」が残っていれば、結果を各行に反映したうえで解除する
          ...(songOrder ? { order: null } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error ?? "保存に失敗しました");
      }
      setLocalVoices((prev) => ({
        ...prev,
        ...Object.fromEntries(plan.map(({ line, next }) => [line.lineIndex, next])),
      }));
      setSongOrder(null);
      if (kind === "all") {
        setBulk(bulkDefaults());
        setBulkOrder(DEFAULT_ORDER);
        setBulkOrderTouched(false);
      }
      setBulkConfirm(false);
      setParenConfirm(false);
      setBulkMessage(`${plan.length}行を書き換えました`);
    } catch (err) {
      setVocalError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBulkSaving(false);
    }
  }

  // 編集対象の行と同じ見出しで連続している行（「セクション全体」の範囲）
  function sectionRange(index: number): Line[] {
    const label = lines[index].sectionLabel;
    if (!label) return [lines[index]];
    let a = index;
    let b = index;
    while (a > 0 && lines[a - 1].sectionLabel === label) a--;
    while (b < lines.length - 1 && lines[b + 1].sectionLabel === label) b++;
    return lines.slice(a, b + 1);
  }

  async function saveVocals(index: number, scope: VocalScope, parts: VoicePart[] | null) {
    const targets = scope === "section" ? sectionRange(index) : [lines[index]];
    // セクション全体への適用は行全体の歌い手のみ（部分指定は文字位置に依存するため行単位）
    const partsOf = (l: (typeof lines)[number]): VoicePart[] | null =>
      parts && scope === "section" ? [{ end: l.original.length, voices: parts[0].voices }] : parts;
    setVocalSaving(true);
    setVocalError(null);
    try {
      const serialize = (p: VoicePart[] | null) =>
        !p
          ? null
          : p.length === 1
            ? p[0].voices.map(voiceToken)
            : { parts: p.map((x) => ({ end: x.end, v: x.voices.map(voiceToken) })) };
      const changes = Object.fromEntries(
        targets.map((l) => [String(l.lineIndex), serialize(partsOf(l))])
      );
      const res = await fetch(`/api/tracks/${trackId}/vocals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error ?? "保存に失敗しました");
      }
      setLocalVoices((prev) => ({
        ...prev,
        ...Object.fromEntries(targets.map((l) => [l.lineIndex, partsOf(l)])),
      }));
      setEditingVocalIndex(null);
    } catch (err) {
      setVocalError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setVocalSaving(false);
    }
  }

  // 検索結果から #line-N 付きで遷移してきたとき、その行へスクロールして一瞬ハイライトする
  useEffect(() => {
    const match = window.location.hash.match(/^#line-(\d+)$/);
    if (!match) return;
    const lineIndex = Number(match[1]);
    document
      .getElementById(`line-${lineIndex}`)
      ?.scrollIntoView({ block: "center" });
    setFlashLineIndex(lineIndex);
    const timer = setTimeout(() => setFlashLineIndex(null), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Spotifyでこのページの曲が再生中なら、再生位置÷曲の長さを行数に按分して
  // 「だいたい今このセクション」を推定する（行/秒単位の正確な同期ではなく、あくまで目安）
  useEffect(() => {
    if (!BACKEND_URL) return;

    async function pollSection() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/spotify/state`);
        if (!res.ok) return; // 一時的なエラーでは直前の表示を保つ
        const data = await res.json();

        const isThisTrack =
          data.isPlaying &&
          sameTrackTitle(data.trackName ?? "", title) &&
          normalize(data.artistName ?? "") === normalize(artistName) &&
          typeof data.progressMs === "number" &&
          typeof data.durationMs === "number" &&
          data.durationMs > 0;

        if (!isThisTrack || lines.length === 0) {
          setCurrentSectionLabel(null);
          return;
        }

        const ratio = Math.min(1, Math.max(0, data.progressMs / data.durationMs));
        const estimatedIndex = Math.min(
          lines.length - 1,
          Math.floor(ratio * lines.length)
        );
        setCurrentSectionLabel(lines[estimatedIndex]?.sectionLabel ?? null);
      } catch {
        // 一時的なネットワークエラーはポーリング継続
      }
    }

    pollSection();
    const interval = setInterval(pollSection, 3000);
    // スマホはバックグラウンドでタイマーが止まるため、画面に戻った時点ですぐ取り直す
    const onVisible = () => {
      if (document.visibilityState === "visible") pollSection();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  function closePopup() {
    setSelection(null);
    setConfirmingDelete(false);
    setContextNote({ loading: false, text: null });
  }

  useEffect(() => {
    function evaluateSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      const text = sel.toString().trim();
      if (!text) return;

      const anchorEl =
        sel.anchorNode?.nodeType === Node.TEXT_NODE
          ? sel.anchorNode.parentElement
          : (sel.anchorNode as HTMLElement | null);
      const lineEl = anchorEl?.closest<HTMLElement>("[data-line-index]");
      if (!lineEl) return;
      // 曲タイトル（data-line-index="-1"）はコンテナの外にあるが、歌詞と同じく選択対象にする
      const isTitle = lineEl.dataset.lineIndex === "-1";
      if (!isTitle && !containerRef.current?.contains(lineEl)) return;

      const lineIndex = Number(lineEl.dataset.lineIndex);
      const original = lineEl.dataset.original ?? "";
      const rect = sel.getRangeAt(0).getBoundingClientRect();

      setSelection({
        lineIndex,
        original,
        text,
        isPhrase: text.split(/\s+/).length > 1,
        rect,
      });
      setLastExplanation(null);
      setConfirmingDelete(false);
      setContextNote({ loading: false, text: null });
      setPopup({ mode: "menu" });
    }

    // PC: mouseupで即座に反応。ただしポップアップ内のボタン操作（登録するなど）では、
    // クリック時点で古いテキスト選択がまだ残っていることがあり、それを新規選択と誤認して
    // ポップアップの状態を巻き戻してしまうことがあるため、ポップアップ内でのmouseupは無視する
    function handleMouseUp(e: MouseEvent) {
      if ((e.target as HTMLElement)?.closest("[data-vocab-popup]")) return;
      evaluateSelection();
    }

    // スマホ: 選択ハンドルのドラッグではmouseup/touchendが確実に発火しないため、
    // selectionchangeを正としてデバウンスしながら監視する
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function handleSelectionChange() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(evaluateSelection, 200);
    }

    // ポインタダウン（マウス/タッチ/ペン共通）で新しい選択操作が始まったらポップアップを一旦閉じる
    function handlePointerDown(e: PointerEvent) {
      if ((e.target as HTMLElement)?.closest("[data-vocab-popup]")) return;
      if ((e.target as HTMLElement)?.closest("mark")) return;
      setSelection(null);
      setConfirmingDelete(false);
    }

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("pointerdown", handlePointerDown);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  // タイトル上の登録済みマーカーのクリック（TrackTitleから届く）
  useEffect(() => {
    const onTitleClick = (e: Event) => {
      const { span, text, rect } = (e as CustomEvent<KnownTitleClickDetail>).detail;
      handleKnownClick(span, rect, text, -1);
    };
    window.addEventListener(KNOWN_TITLE_CLICK_EVENT, onTitleClick);
    return () => window.removeEventListener(KNOWN_TITLE_CLICK_EVENT, onTitleClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  function handleKnownClick(
    span: KnownSpan,
    rect: DOMRect,
    matchedText: string,
    lineIndex: number
  ) {
    window.getSelection()?.removeAllRanges();
    setConfirmingDelete(false);
    setContextNote({ loading: false, text: null });
    setSelection({
      lineIndex,
      original: matchedText,
      text: matchedText,
      isPhrase: matchedText.split(/\s+/).length > 1,
      rect,
      existingVocabEntryId: span.vocabEntryId,
    });
    setPopup({
      mode: "viewEntry",
      vocabEntryId: span.vocabEntryId,
      term: span.term,
      meaning: span.meaning,
      partOfSpeech: span.partOfSpeech,
      cefr: span.cefr,
      ipa: span.ipa,
      explanation: span.explanation,
      isOriginTrack: span.sourceTrackId === trackId,
      knownSpan: span,
    });
  }

  async function handleExplainContext() {
    if (!selection || !BACKEND_URL || Number.isNaN(selection.lineIndex)) return;
    setContextNote({ loading: true, text: null });
    try {
      const res = await fetch(`${BACKEND_URL}/api/vocab/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          lineIndex: selection.lineIndex,
          selectedText: selection.text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "解説の取得に失敗しました");
      setContextNote({ loading: false, text: data.explanation });
    } catch (err) {
      setContextNote({
        loading: false,
        text: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  async function handleExplain() {
    if (!selection || !BACKEND_URL) return;
    setPopup({ mode: "loading", action: "explain" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/vocab/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          lineIndex: selection.lineIndex,
          selectedText: selection.text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "解説の取得に失敗しました");
      setLastExplanation(data.explanation);
      setPopup({ mode: "explanation", text: data.explanation });
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  async function handlePreviewRegister(override?: { text: string; isPhrase: boolean }) {
    if (!selection || !BACKEND_URL) return;
    const target = override ?? { text: selection.text, isPhrase: selection.isPhrase };
    setPopup({ mode: "loading", action: "preview" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/vocab/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term: target.text,
          isPhrase: target.isPhrase,
          trackId,
          lineIndex: selection.lineIndex,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録内容の取得に失敗しました");
      setPopup({
        mode: "confirm",
        term: data.term,
        meaning: data.meaning,
        partOfSpeech: data.partOfSpeech,
        cefr: data.cefr,
        ipa: data.ipa,
        explanation: lastExplanation,
        isExisting: data.isExisting,
        coreWord: data.coreWord ?? null,
      });
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  // 「まとまりで覚える価値が低い」と判定された複数語選択を、鍵となる1語の登録に切り替える
  function handleSwitchToCoreWord(coreWord: string) {
    setSelection((s) => (s ? { ...s, text: coreWord, isPhrase: false } : s));
    handlePreviewRegister({ text: coreWord, isPhrase: false });
  }

  async function handleConfirmRegister() {
    if (!selection || !BACKEND_URL || popup.mode !== "confirm") return;
    const confirmed = popup;
    setPopup({ mode: "loading", action: "register" });
    try {
      const res = await fetch(`${BACKEND_URL}/api/vocab/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term: selection.text,
          isPhrase: selection.isPhrase,
          trackId,
          lineIndex: selection.lineIndex,
          meaning: confirmed.meaning,
          partOfSpeech: confirmed.partOfSpeech,
          cefr: confirmed.cefr,
          ipa: confirmed.ipa,
          explanation: confirmed.explanation,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録に失敗しました");
      setPopup({
        mode: "registered",
        meaning: data.meaning,
        partOfSpeech: data.partOfSpeech,
        cefr: data.cefr,
        ipa: data.ipa,
      });
      router.refresh();
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  async function handleDeleteEntry() {
    if (!selection?.existingVocabEntryId || !BACKEND_URL) return;

    setPopup({ mode: "loading", action: "delete" });
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/vocab/${selection.existingVocabEntryId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "削除に失敗しました");
      }
      closePopup();
      router.refresh();
    } catch (err) {
      setPopup({
        mode: "error",
        message: err instanceof Error ? err.message : "エラーが発生しました",
      });
    }
  }

  return (
    <div ref={containerRef} className="relative flex flex-col">
      {vocalEditMode && (
        <div
          data-vocal-editor
          className="mb-3 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs"
        >
          <p className="font-medium">確認した資料</p>
          {sources.length > 0 && (
            <div className="flex flex-col gap-0.5 text-emerald-700">
              {sources.map((r, i) => (
                <div key={i} className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 break-all">
                    ✓{" "}
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline">
                      {r.url}
                    </a>
                    {r.note && <span className="ml-2 text-zinc-900">{r.note}</span>}
                  </p>
                  {sourcesEditing && (
                    <button
                      onClick={() => postSources({ removeSource: r.url })}
                      disabled={sourcesSaving}
                      className="shrink-0 px-1 text-red-500 disabled:opacity-50"
                    >
                      削除
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {sourcesEditing &&
            sourcesDraft.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  type="url"
                  value={r.url}
                  onChange={(e) => updateSourceDraft(i, { url: e.target.value })}
                  placeholder="https://..."
                  className="min-w-0 flex-[2] rounded-lg border border-zinc-300 px-2 py-1.5"
                />
                <input
                  type="text"
                  value={r.note}
                  onChange={(e) => updateSourceDraft(i, { note: e.target.value })}
                  placeholder="メモ（任意）"
                  maxLength={200}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1.5"
                />
                <button
                  onClick={() => setSourcesDraft((prev) => prev.filter((_, k) => k !== i))}
                  className="px-1 text-red-500"
                >
                  削除
                </button>
              </div>
            ))}
          <div className="flex items-center gap-2">
            {sourcesEditing ? (
              <>
                <button
                  onClick={() => setSourcesDraft((prev) => [...prev, { url: "", note: "" }])}
                  className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-white"
                >
                  資料を追加
                </button>
                <button
                  onClick={saveSources}
                  disabled={sourcesSaving}
                  className="rounded-full bg-zinc-900 px-3 py-1 font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  {sourcesSaving ? "保存中..." : "保存"}
                </button>
              </>
            ) : (
              <button
                onClick={() => setSourcesEditing(true)}
                className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-white"
              >
                資料を編集
              </button>
            )}
          </div>
          {sourcesError && <p className="text-red-500">{sourcesError}</p>}
        </div>
      )}
      {vocalEditMode && (
        <details
          data-vocal-editor
          className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs"
        >
          <summary className="cursor-pointer select-none text-zinc-500">
            曲全体に一括適用{songOrder ? "（旧・並び固定中）" : ""}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-zinc-400">
              変えたい人だけ「設定」か「削除」を選び、「全行に適用」で全ての行を書き換えます（適用後は行ごとに直せます）。
              上から順の並びは▲▼で指定します。
            </p>
            {bulkOrder.map((m, i) => {
              const b = bulk[m];
              return (
                <div key={m} className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-block h-[3px] w-5 rounded-full"
                    style={{ backgroundColor: b.role === "H" && b.mode === "set" ? MEMBERS[m].color + "99" : MEMBERS[m].color }}
                  />
                  <span className="w-14 font-medium">{MEMBERS[m].name}</span>
                  {(
                    [
                      ["keep", "変更しない"],
                      ["set", "設定"],
                      ["remove", "削除"],
                    ] as [BulkMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => updateBulk(m, { mode })}
                      className={`rounded-full border px-2 py-0.5 ${
                        b.mode === mode
                          ? mode === "remove"
                            ? "border-red-500 bg-red-500 text-white"
                            : "border-zinc-800 bg-zinc-800 text-white"
                          : "border-zinc-300 hover:bg-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {b.mode === "set" && (
                    <>
                      <button
                        onClick={() => updateBulk(m, { role: b.role === "L" ? "H" : "L" })}
                        className="rounded-full border border-zinc-300 px-2 py-0.5 hover:bg-white"
                      >
                        {b.role === "L" ? "濃い線" : "ユニゾン（薄い線）"}
                      </button>
                      <button
                        onClick={() => updateBulk(m, { double: !b.double })}
                        className={`rounded-full border px-2 py-0.5 ${
                          b.double ? "border-zinc-800 bg-zinc-800 text-white" : "border-zinc-300 hover:bg-white"
                        }`}
                      >
                        ダブル
                      </button>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={b.add}
                          onChange={(e) => updateBulk(m, { add: e.target.checked })}
                        />
                        歌っていない行にも追加
                      </label>
                    </>
                  )}
                  <button onClick={() => moveBulkOrder(i, -1)} className="px-1 text-zinc-500">
                    ▲
                  </button>
                  <button onClick={() => moveBulkOrder(i, 1)} className="px-1 text-zinc-500">
                    ▼
                  </button>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-2">
              {bulkConfirm ? (
                <>
                  <span className="text-zinc-600">{planBulk().length}行を書き換えます。よろしいですか？</span>
                  <button
                    onClick={() => runBulk()}
                    disabled={bulkSaving}
                    className="rounded-full bg-zinc-900 px-3 py-1 font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {bulkSaving ? "適用中..." : "実行"}
                  </button>
                  <button
                    onClick={() => setBulkConfirm(false)}
                    disabled={bulkSaving}
                    className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-white disabled:opacity-50"
                  >
                    やめる
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setBulkConfirm(true)}
                  disabled={!bulkHasWork}
                  className="rounded-full bg-zinc-900 px-3 py-1 font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
                >
                  全行に適用
                </button>
              )}
              {songOrder && (
                <button
                  onClick={() => saveSongOrder(null)}
                  disabled={orderSaving}
                  className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-white disabled:opacity-50"
                >
                  並び固定を解除
                </button>
              )}
              {bulkMessage && <span className="text-emerald-700">{bulkMessage}</span>}
            </div>
            <div className="mt-2 flex flex-col gap-2 border-t border-zinc-200 pt-3">
              <p className="font-medium text-zinc-600">かっこ書き（コーラス）をまとめて設定</p>
              <p className="text-zinc-400">
                「(...)」の中だけを、チェックした人の線に差し替えます（かっこの外は変わりません）。上から順は▲▼で指定します。
              </p>
              {parenOrder.map((m, i) => {
                const b = paren[m];
                return (
                  <div key={m} className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-block h-[3px] w-5 rounded-full"
                      style={{ backgroundColor: b.on && b.role === "H" ? MEMBERS[m].color + "99" : MEMBERS[m].color }}
                    />
                    <label className="flex w-20 items-center gap-1 font-medium">
                      <input type="checkbox" checked={b.on} onChange={(e) => updateParen(m, { on: e.target.checked })} />
                      {MEMBERS[m].name}
                    </label>
                    {b.on && (
                      <>
                        <button
                          onClick={() => updateParen(m, { role: b.role === "L" ? "H" : "L" })}
                          className="rounded-full border border-zinc-300 px-2 py-0.5 hover:bg-white"
                        >
                          {b.role === "L" ? "濃い線（ハモリ）" : "ユニゾン（薄い線）"}
                        </button>
                        <button
                          onClick={() => updateParen(m, { double: !b.double })}
                          className={`rounded-full border px-2 py-0.5 ${
                            b.double ? "border-zinc-800 bg-zinc-800 text-white" : "border-zinc-300 hover:bg-white"
                          }`}
                        >
                          ダブル
                        </button>
                      </>
                    )}
                    <button onClick={() => moveParenOrder(i, -1)} className="px-1 text-zinc-500">
                      ▲
                    </button>
                    <button onClick={() => moveParenOrder(i, 1)} className="px-1 text-zinc-500">
                      ▼
                    </button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setParen(parenBoysPreset());
                    setParenOrder(DEFAULT_ORDER);
                    setParenConfirm(false);
                  }}
                  className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-white"
                >
                  Boys型にする（ポール＝ハモリ／ジョン・ジョージ＝ユニゾン）
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {parenConfirm ? (
                  <>
                    <span className="text-zinc-600">かっこ書きのある{planParen().length}行を書き換えます。よろしいですか？</span>
                    <button
                      onClick={() => runBulk("paren")}
                      disabled={bulkSaving}
                      className="rounded-full bg-zinc-900 px-3 py-1 font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                    >
                      {bulkSaving ? "適用中..." : "実行"}
                    </button>
                    <button
                      onClick={() => setParenConfirm(false)}
                      disabled={bulkSaving}
                      className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-white disabled:opacity-50"
                    >
                      やめる
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setParenConfirm(true)}
                    disabled={!parenOrder.some((m) => paren[m].on)}
                    className="rounded-full bg-zinc-900 px-3 py-1 font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
                  >
                    かっこの中に適用
                  </button>
                )}
              </div>
            </div>
            {vocalError && editingVocalIndex === null && <p className="text-red-500">{vocalError}</p>}
          </div>
        </details>
      )}
      {lines.map((line, index) => {
        const prevLabel = index > 0 ? lines[index - 1].sectionLabel : null;
        const sectionLabel =
          line.sectionLabel && line.sectionLabel !== prevLabel ? line.sectionLabel : null;
        const isNewSection = Boolean(sectionLabel) && index > 0;
        const isCurrentSection =
          Boolean(currentSectionLabel) && line.sectionLabel === currentSectionLabel;
        // 複数行にまたがる文は、訳を最終行の下に1つだけ出す（sentenceStartがnullの古いデータは1行1文）
        const sentenceKey = line.sentenceStart ?? line.lineIndex;
        const prevLine = index > 0 ? lines[index - 1] : null;
        const nextLine = index < lines.length - 1 ? lines[index + 1] : null;
        const isSentenceEnd = !nextLine || (nextLine.sentenceStart ?? nextLine.lineIndex) !== sentenceKey;
        const isMultiLineSentence =
          (prevLine !== null && (prevLine.sentenceStart ?? prevLine.lineIndex) === sentenceKey) ||
          !isSentenceEnd;
        const isSentenceStart =
          !prevLine || (prevLine.sentenceStart ?? prevLine.lineIndex) !== sentenceKey;
        // 同じ文の行どうしは行間を詰める
        const paddingY = isMultiLineSentence
          ? `${isSentenceStart ? "pt-3" : "pt-0.5"} ${isSentenceEnd ? "pb-3" : "pb-0.5"}`
          : "py-3";

        return (
        <div
          key={line.id}
          id={`line-${line.lineIndex}`}
          data-line-index={line.lineIndex}
          data-original={line.original}
          className={`flex scroll-mt-20 flex-col gap-1 ${paddingY} transition-colors duration-700 ${
            flashLineIndex === line.lineIndex ? "bg-amber-100" : ""
          } ${
            isNewSection ? "border-t border-zinc-200 pt-4" : ""
          } ${isMultiLineSentence ? "border-l-2 border-l-zinc-200 pl-3" : ""} ${
            isMultiLineSentence && index > 0 && isSentenceStart ? "mt-2" : ""
          }`}
        >
          {sectionLabel && (
            <div
              className={`mb-1 text-xs font-semibold tracking-wide transition-colors duration-500 ${
                isCurrentSection ? "text-amber-600" : ""
              }`}
              style={isCurrentSection ? undefined : { color: "rgb(117 117 125)" }}
            >
              {isCurrentSection && "▶ "}[{sectionLabel}]
            </div>
          )}
          {(() => {
            const lineParts = partsFor(line);
            // 部分ごとに線の本数が違っても線の位置・行間が揃うよう、最大の高さに合わせる
            const pad = Math.max(...lineParts.map((p) => underlineTotal(p.voices)));
            const hasUnderline = pad > 0;
            const editing = vocalEditMode && editingVocalIndex === index;
            let start = 0;
            return (
              <p
                className="break-words font-medium leading-relaxed"
                style={hasUnderline ? { lineHeight: voiceUnderlineStyle([], pad)?.lineHeight } : undefined}
              >
                {lineParts.map((part, pi) => {
                  const from = start;
                  const to = part.end;
                  start = to;
                  const underline = voiceUnderlineStyle(part.voices, hasUnderline ? pad : undefined);
                  const shift = <T extends { start: number; end: number }>(spans: T[]): T[] =>
                    spans
                      .filter((sp) => sp.start >= from && sp.end <= to)
                      .map((sp) => ({ ...sp, start: sp.start - from, end: sp.end - from }));
                  return (
                    <span
                      key={pi}
                      aria-label={part.voices.length > 0 ? "歌っている人" : undefined}
                      title={
                        part.voices.length > 0
                          ? part.voices
                              .map(
                                (v) =>
                                  `${MEMBERS[v.member].name}（${roleLabel(v, part.voices.length)}${v.double ? "・ダブルトラック" : ""}）`
                              )
                              .join(" / ")
                          : undefined
                      }
                      className={vocalEditMode ? "cursor-pointer" : undefined}
                      style={{
                        ...(underline?.span ?? {}),
                        // 編集モードでは、線が無い行にも点線を出してタップ対象だと分かるようにする
                        ...(vocalEditMode && !hasUnderline
                          ? { borderBottom: "1px dashed #d4d4d8", paddingBottom: 2 }
                          : {}),
                        ...(editing ? { backgroundColor: "rgba(0,0,0,0.05)" } : {}),
                      }}
                      onClick={
                        vocalEditMode
                          ? () => {
                              // 文字の選択（語彙登録）のためのドラッグではエディタを開かない
                              if (!window.getSelection()?.isCollapsed) return;
                              setVocalError(null);
                              setEditingVocalIndex(index);
                            }
                          : undefined
                      }
                    >
                      {renderWithHighlights(
                        line.original.slice(from, to),
                        shift(line.knownSpans),
                        shift(line.hardSpans),
                        (span, el, matchedText) =>
                          handleKnownClick(
                            { ...span, start: span.start + from, end: span.end + from },
                            el.getBoundingClientRect(),
                            matchedText,
                            line.lineIndex
                          )
                      )}
                    </span>
                  );
                })}
              </p>
            );
          })()}
          {isSentenceEnd && line.translation && (
            <p className="break-words text-sm text-zinc-500">{line.translation}</p>
          )}
          {line.explanation && (
            <details className="text-sm text-zinc-400">
              <summary className="cursor-pointer select-none italic">💡 解説</summary>
              <p className="mt-1 break-words">{line.explanation}</p>
            </details>
          )}
        </div>
        );
      })}

      {vocalEditMode && editingVocalIndex !== null && lines[editingVocalIndex] && (
        <VocalEditor
          key={editingVocalIndex}
          lineText={lines[editingVocalIndex].original}
          initialParts={partsFor(lines[editingVocalIndex])}
          orderLocked={songOrder !== null}
          sectionLabel={lines[editingVocalIndex].sectionLabel}
          sectionLineCount={sectionRange(editingVocalIndex).length}
          saving={vocalSaving}
          error={vocalError}
          onSave={(parts, scope) => saveVocals(editingVocalIndex, scope, parts)}
          onReset={(scope) => saveVocals(editingVocalIndex, scope, null)}
          onClose={() => setEditingVocalIndex(null)}
        />
      )}

      {selection && (
        <div
          data-vocab-popup
          className="fixed z-50 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg"
          style={(() => {
            const vh = window.innerHeight;
            // iOS標準のコピー/調べるメニューが選択範囲の上に出るため、常に下に表示する
            const space = Math.max(120, vh - selection.rect.bottom - 16);
            return {
              top: selection.rect.bottom + 8,
              left: Math.min(Math.max(8, selection.rect.left), window.innerWidth - 280 - 8),
              maxWidth: 280,
              maxHeight: space,
              overflowY: "auto" as const,
            };
          })()}
        >
          {popup.mode === "menu" && (
            <div className="flex gap-2">
              <button
                onClick={handleExplain}
                className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
              >
                詳しく!
              </button>
              <button
                onClick={() => handlePreviewRegister()}
                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
              >
                📔 登録
              </button>
              <button
                onClick={closePopup}
                className="ml-auto text-xs text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>
          )}

          {popup.mode === "loading" && (
            <p className="text-xs text-zinc-500">
              {popup.action === "explain" && "解説を生成中..."}
              {popup.action === "preview" && "登録内容を確認中..."}
              {popup.action === "register" && "登録中..."}
              {popup.action === "delete" && "削除中..."}
            </p>
          )}

          {popup.mode === "explanation" && (
            <>
              <p className="break-words leading-relaxed text-zinc-700">{popup.text}</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handlePreviewRegister()}
                  className="w-fit rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-50"
                >
                  📔 登録
                </button>
                <button
                  onClick={closePopup}
                  className="text-xs text-zinc-400 hover:text-zinc-600"
                >
                  閉じる
                </button>
              </div>
            </>
          )}

          {popup.mode === "confirm" && (
            <>
              <p className="text-xs font-medium text-zinc-500">
                {popup.isExisting ? "この語彙は登録済みです" : "以下の内容で登録します"}
              </p>
              <p className="break-words font-semibold text-zinc-800">
                {popup.term}
                {popup.ipa && (
                  <span className="ml-2 font-normal text-zinc-400">{popup.ipa}</span>
                )}
              </p>
              <p className="break-words text-zinc-700">
                {popup.partOfSpeech && (
                  <span className="mr-1 text-zinc-400">[{popup.partOfSpeech}]</span>
                )}
                {popup.meaning}
                {popup.cefr && <span className="ml-1 text-zinc-400">({popup.cefr})</span>}
              </p>
              {popup.explanation && (
                <p className="break-words rounded bg-zinc-50 p-2 text-xs text-zinc-500">
                  {popup.explanation}
                </p>
              )}
              {popup.coreWord && (
                <div className="flex flex-col gap-1.5 rounded bg-amber-50 p-2">
                  <p className="text-xs text-amber-800">
                    これは決まった慣用表現ではなく、通常の文法の組み合わせです。つまずきの原因は
                    「{popup.coreWord}」の意味かもしれません。
                  </p>
                  <button
                    onClick={() => handleSwitchToCoreWord(popup.coreWord!)}
                    className="w-fit rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    「{popup.coreWord}」を登録する
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleConfirmRegister}
                  className={
                    popup.coreWord
                      ? "w-fit rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                      : "w-fit rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
                  }
                >
                  {popup.coreWord ? "フレーズのまま登録する" : "登録する"}
                </button>
                <button
                  onClick={closePopup}
                  className="text-xs text-zinc-400 hover:text-zinc-600"
                >
                  キャンセル
                </button>
              </div>
            </>
          )}

          {popup.mode === "registered" && (
            <>
              <p className="text-xs font-medium text-emerald-700">📔 単語帳に登録しました</p>
              <p className="break-words text-zinc-700">
                {popup.ipa && <span className="mr-1 text-zinc-400">{popup.ipa}</span>}
                {popup.partOfSpeech && (
                  <span className="mr-1 text-zinc-400">[{popup.partOfSpeech}]</span>
                )}
                {popup.meaning}
                {popup.cefr && <span className="ml-1 text-zinc-400">({popup.cefr})</span>}
              </p>
              <button
                onClick={closePopup}
                className="w-fit text-xs text-zinc-400 hover:text-zinc-600"
              >
                閉じる
              </button>
            </>
          )}

          {popup.mode === "viewEntry" && (
            <>
              <div className="flex items-start justify-between gap-2">
                <p className="break-words font-semibold text-zinc-800">
                  {popup.term}
                  {popup.ipa && (
                    <span className="ml-2 font-normal text-zinc-400">{popup.ipa}</span>
                  )}
                </p>
                <button
                  onClick={closePopup}
                  aria-label="閉じる"
                  className="shrink-0 text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>
              <p className="break-words text-zinc-700">
                {popup.partOfSpeech && (
                  <span className="mr-1 text-zinc-400">[{popup.partOfSpeech}]</span>
                )}
                {popup.meaning}
                {popup.cefr && <span className="ml-1 text-zinc-400">({popup.cefr})</span>}
              </p>
              <p className="break-words text-xs text-zinc-400">
                📍 最初に登録した曲:{" "}
                {popup.isOriginTrack ? (
                  <span className="text-zinc-600">この曲（{popup.knownSpan.sourceTrackTitle}）</span>
                ) : (
                  <a
                    href={`/tracks/${popup.knownSpan.sourceTrackId}${
                      popup.knownSpan.sourceLineIndex >= 0 ? `#line-${popup.knownSpan.sourceLineIndex}` : ""
                    }`}
                    className="text-zinc-600 underline decoration-dotted hover:text-zinc-800"
                  >
                    {popup.knownSpan.sourceTrackTitle}
                  </a>
                )}
              </p>
              {popup.isOriginTrack && popup.explanation ? (
                <p className="break-words rounded bg-zinc-50 p-2 text-xs text-zinc-600">
                  {popup.explanation}
                </p>
              ) : contextNote.text ? (
                <p className="break-words rounded bg-zinc-50 p-2 text-xs text-zinc-600">
                  {contextNote.text}
                </p>
              ) : (
                <button
                  onClick={handleExplainContext}
                  disabled={contextNote.loading}
                  className="w-fit text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-700 disabled:opacity-50"
                >
                  {contextNote.loading ? "この曲での意味を確認中..." : "🔍 この曲での意味を見る"}
                </button>
              )}

              {confirmingDelete ? (
                <div className="flex flex-col gap-1.5 rounded bg-red-50 p-2">
                  <p className="text-xs text-red-700">
                    単語帳から削除しますか？（すべての出現箇所から消えます）
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleDeleteEntry}
                      className="w-fit rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                    >
                      削除する
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      className="text-xs text-zinc-500 hover:text-zinc-700"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="w-fit text-xs text-red-500 hover:text-red-700"
                >
                  削除
                </button>
              )}
            </>
          )}

          {popup.mode === "error" && (
            <>
              <p className="break-words text-xs text-red-600">{popup.message}</p>
              <button
                onClick={closePopup}
                className="w-fit text-xs text-zinc-400 hover:text-zinc-600"
              >
                閉じる
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
