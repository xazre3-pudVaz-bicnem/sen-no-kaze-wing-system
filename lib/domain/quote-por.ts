/**
 * 正式見積で、金額が未確定の明細を残さない（D1 までの暫定。2026-10-19 の先方回答 ③・2026-10-22 の確定事項 A-2-1）。
 *
 * DB の quote_line_explicit_state・quote_line_por_marked・quote_line_unresolved・quote_line_state_guard・
 * configuration_por_selections（20261016111000）と同じ決まり。発行を止めるのは DB で、画面はこの関数で先に案内する。
 * ローカル検証モードはこの関数で同じ止めをする。
 *
 * 明細の扱いは「金額確定／金額未確定／契約対象外／0円確定」を区別する。自由記述の備考の文章から状態を推測しない。
 * 「対象外」「0円確定」は画面の明示の選択からサーバーが備考に印を付ける（手入力の印は受け付けない）。
 */
import { exteriorFaceLabel, type ExteriorFaceSelection } from './exterior-wall';

/** POR の目印になる備考（手入力・改訂の画面は「別途見積」、標準見積からの概算は「価格未確定（別途お見積り）」） */
export const POR_REMARKS = ['別途見積', '価格未確定（別途お見積り）'] as const;
/** 外壁の面の明細で、別途見積の項目を含むときの備考の書き出し */
export const POR_FACE_REMARK_PREFIX = '別途見積項目あり';
/** Web の概算で POR の商品に付く説明 */
export const POR_DESCRIPTION = '設置場所確認後に別途お見積り';

/** 今回の契約対象外の印（続けて任意のメモ） */
export const EXCLUDED_MARKER = '［今回の契約対象外］';
/** 0円確定の印の書き出し（理由が続く） */
export const ZERO_CONFIRMED_PREFIX = '［0円確定］';
/** 0円確定の印（この後に理由） */
export const ZERO_CONFIRMED_MARKER = '［0円確定］：';
/** 理由・メモの長さの上限（備考の 200 文字に印（10 文字・7 文字）を足しても収まるように） */
export const LINE_STATE_REASON_MAX = 190;

/** 明細の状態（印で表すもの）。金額確定・金額未確定は印を持たない */
export type QuoteLineState = 'excluded' | 'zero_confirmed';

export const QUOTE_LINE_STATE_LABELS: Record<QuoteLineState, string> = {
  excluded: '対象外',
  zero_confirmed: '0円確定',
};

/** SQL の btrim と同じく、前後の半角スペースだけを取り除く */
function btrim(value: string | null | undefined): string {
  return (value ?? '').replace(/^ +| +$/g, '');
}

/** DB の quote_line_explicit_state と同じ。印が無ければ null */
export function parseQuoteLineState(remark: string | null | undefined): { state: QuoteLineState; reason: string } | null {
  const value = remark ?? '';
  if (value.startsWith(EXCLUDED_MARKER)) {
    return { state: 'excluded', reason: value.slice(EXCLUDED_MARKER.length).trim() };
  }
  if (/^［0円確定］：\s*\S/.test(value)) {
    return { state: 'zero_confirmed', reason: value.slice(ZERO_CONFIRMED_MARKER.length).trim() };
  }
  return null;
}

/** 状態の印で始まる備考か（印の形が崩れているものも含む。手入力の拒否と、表の保存境界に使う） */
export function isReservedLineStateRemark(remark: string | null | undefined): boolean {
  const value = remark ?? '';
  return value.startsWith(EXCLUDED_MARKER) || value.startsWith(ZERO_CONFIRMED_PREFIX);
}

/** 画面の入力の誤り（サーバーで印を組み立てるとき・ローカル検証モードの保存境界） */
export class QuoteLineStateInputError extends Error {}

/** 状態の印を組み立てる（サーバーだけが使う） */
export function quoteLineStateRemark(state: QuoteLineState, reason: string | null | undefined): string {
  const text = (reason ?? '').trim();
  if (text.length > LINE_STATE_REASON_MAX) {
    throw new QuoteLineStateInputError(`理由・メモは ${LINE_STATE_REASON_MAX} 文字以内で入力してください`);
  }
  if (state === 'zero_confirmed') {
    if (!text) throw new QuoteLineStateInputError('0円確定の明細は理由を入力してください');
    return `${ZERO_CONFIRMED_MARKER}${text}`;
  }
  return text ? `${EXCLUDED_MARKER}${text}` : EXCLUDED_MARKER;
}

/** 「0円確定」「対象外」を選べる区分（本体・経費の行は、本体 Revision・経費の決まりで扱うので選べない） */
export const LINE_STATE_KINDS: ReadonlySet<string> = new Set(['interior_exterior', 'option', 'installation', 'free']);

export interface QuoteLineStateInput {
  kind?: string | null;
  name?: string | null;
  remark?: string | null;
  unit_price: number;
  line_state?: QuoteLineState | null;
  line_state_reason?: string | null;
}

/**
 * 画面の明示の選択（line_state）から、保存する備考を決める（サーバーの保存処理で使う）。
 * 印を備考に直接書いたものは受け付けない。「対象外」「0円確定」の明細は 0 円に限る。
 */
export function applyQuoteLineStateInput(row: QuoteLineStateInput): string | null {
  const name = row.name?.trim() || '（品名なし）';
  if (!row.line_state) {
    const remark = (row.remark ?? '').trim();
    if (isReservedLineStateRemark(remark)) {
      throw new QuoteLineStateInputError(`「${name}」：「対象外」「0円確定」は画面の選択で設定してください（備考には直接書けません）`);
    }
    return remark || null;
  }
  if (row.kind && !LINE_STATE_KINDS.has(row.kind)) {
    throw new QuoteLineStateInputError(`本体・経費の明細（${name}）は「対象外」「0円確定」にできません`);
  }
  if (row.unit_price !== 0) {
    throw new QuoteLineStateInputError(`「対象外」「0円確定」の明細（${name}）は 0 円にしてください`);
  }
  return quoteLineStateRemark(row.line_state, row.line_state_reason);
}

/** 編集画面の行の初期値：備考に状態の印があれば、状態と理由・メモに分ける（備考は空にする） */
export function splitQuoteLineStateRemark(remark: string | null | undefined): {
  line_state: QuoteLineState | null;
  line_state_reason: string;
  remark: string;
} {
  const parsed = parseQuoteLineState(remark);
  if (parsed) return { line_state: parsed.state, line_state_reason: parsed.reason, remark: '' };
  return { line_state: null, line_state_reason: '', remark: remark ?? '' };
}

/**
 * 扱いの理由・メモの初期値：今の備考（別途見積の目印でないもの）を入れておく（扱いを選んでも備考を黙って消さない）。
 * 備考は 200 文字まで、理由・メモは 190 文字までなので、190 文字を超える備考だけは超えた分が入らない
 */
export function lineStateReasonSeed(remark: string | null | undefined): string {
  const text = (remark ?? '').trim();
  if (!text || isReservedLineStateRemark(text) || isPorMarkedLine({ remark: text })) return '';
  return text.slice(0, LINE_STATE_REASON_MAX);
}

/**
 * 編集画面で扱いを選んだときの行。「0円確定」「対象外」は 0 円にする。
 * 「対象外」のメモが空なら今の備考を入れておく（備考を黙って消さない）。「0円確定」の理由は必須なので、今の備考では埋めない
 * （前から 0円確定 の行の理由はそのまま。今の備考は理由の欄の例として出す：zeroConfirmedReasonPlaceholder）。
 * 扱いを外したときは備考を元のままにする（金額は入れ直す）。備考が空なら、理由・メモを備考へ戻す（黙って消さない）
 */
export function chooseQuoteLineState<
  T extends { remark?: string | null; unit_price: number | null; line_state: QuoteLineState | null; line_state_reason: string },
>(row: T, state: QuoteLineState | null): T {
  if (!state) {
    const remark = (row.remark ?? '').trim() ? row.remark : row.line_state_reason.trim() || row.remark;
    return { ...row, line_state: null, remark };
  }
  const reason =
    state === 'zero_confirmed'
      ? row.line_state === 'zero_confirmed'
        ? row.line_state_reason
        : ''
      : row.line_state_reason.trim()
        ? row.line_state_reason
        : lineStateReasonSeed(row.remark);
  return { ...row, line_state: state, unit_price: 0, line_state_reason: reason };
}

/** 「0円確定」の理由の欄の例。今の備考があれば添える（保存すると備考は理由に置き換わるため、黙って消さない） */
export function zeroConfirmedReasonPlaceholder(remark: string | null | undefined, example?: string): string {
  const current = lineStateReasonSeed(remark);
  if (current) return `0円確定の理由（必須）。今の備考：${current}`;
  return example ? `0円確定の理由（必須。${example}）` : '0円確定の理由（必須）';
}

/** 画面が送った別途見積の一覧の key（JSON の文字列の配列）。形が違えば null（Server Action で使う） */
export function parsePorSelectionKeys(value: FormDataEntryValue | null): string[] | null {
  if (value === null || value === '') return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    if (!Array.isArray(parsed) || parsed.length > 500) return null;
    // 外壁の面のキーは別途見積の選択肢の ID を含むので長くなる
    if (!parsed.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 1000)) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

/** 見積書・明細の表の金額欄：対象外の行は「対象外」と出す（0 円の確定と区別する）。印が無ければ null */
export function quoteLineStateAmountLabel(remark: string | null | undefined): string | null {
  const parsed = parseQuoteLineState(remark);
  if (!parsed) return null;
  return parsed.state === 'excluded' ? '対象外' : '0円確定';
}

/** 明細の配列に applyQuoteLineStateInput をかけ、保存する明細にする（line_state は備考の印になる） */
export function applyQuoteLineStates<T extends QuoteLineStateInput>(
  rows: T[]
): (Omit<T, 'line_state' | 'line_state_reason'> & { remark: string | null })[] {
  return rows.map((row) => {
    const { line_state: _state, line_state_reason: _reason, ...rest } = row;
    return { ...rest, remark: applyQuoteLineStateInput(row) };
  });
}

/** DB の quote_line_state_guard と同じ（ローカル検証モードの保存境界）。問題があれば文面を返す */
export function quoteLineStateGuardError(line: {
  kind: string;
  name: string;
  remark?: string | null;
  unit_price?: number | null;
  amount?: number | null;
  price_mode?: string | null;
}): string | null {
  if (!isReservedLineStateRemark(line.remark)) return null;
  if (!LINE_STATE_KINDS.has(line.kind)) {
    return `「対象外」「0円確定」は本体・経費の明細には使えません（${line.name}）`;
  }
  if ((line.unit_price ?? 0) !== 0 || (line.amount ?? 0) !== 0) {
    return `「対象外」「0円確定」の明細（${line.name}）は 0 円にしてください`;
  }
  if ((line.remark ?? '').startsWith(ZERO_CONFIRMED_PREFIX) && !/^［0円確定］：\s*\S/.test(line.remark ?? '')) {
    return `0円確定の明細（${line.name}）は理由を入力してください`;
  }
  if (line.price_mode && line.price_mode !== 'manual') {
    return `「対象外」「0円確定」の明細（${line.name}）は、価格の決め方を「金額を入力」にしてください`;
  }
  return null;
}

/** DB の quote_line_por_marked と同じ。別途見積（価格未確定）の目印がある明細か */
export function isPorMarkedLine(line: { description?: string | null; remark?: string | null; optionIsPor?: boolean }): boolean {
  const remark = btrim(line.remark);
  return (
    btrim(line.description) === POR_DESCRIPTION ||
    (POR_REMARKS as readonly string[]).includes(remark) ||
    remark.startsWith(POR_FACE_REMARK_PREFIX) ||
    Boolean(line.optionIsPor)
  );
}

/** 0 円の判定から外す区分（本体は本体 Revision から、経費は経費の決まりで扱う） */
const ZERO_RULE_EXEMPT_KINDS = new Set(['base', 'base_expense', 'interior_exterior_expense', 'option_expense', 'discount']);

export interface QuoteLineCheckInput {
  kind: string;
  unit_price: number | null | undefined;
  description?: string | null;
  remark?: string | null;
  /** 商品台帳の別途見積の商品を指す行か */
  optionIsPor?: boolean;
  /** 商品台帳で正式に 0 円の商品（別途見積でない）を指す行か */
  optionIsCatalogZero?: boolean;
  /** 保存のたびに作り直す経費の行か（標準見積から作る下書きの price_mode = 'auto' かつ line_role = 'expense'） */
  calculated?: boolean;
  /** 前の版に、別途見積でも状態の印つきでもない 0 円の同じ明細があるか */
  unchangedZero?: boolean;
}

/**
 * DB の quote_line_unresolved と同じ。正式発行を止める金額未確定の明細か。
 * 0 円で別途見積の目印がある行（前の版から変えていなくても）と、0 円の内外装・オプション・別途工事・フリー商品の行のうち
 * 商品台帳で正式に 0 円の商品・自動計算の行・前の版の同じ 0 円の明細のどれでもない行。状態の印がある行は止めない。
 */
export function isUnresolvedQuoteLine(line: QuoteLineCheckInput): boolean {
  if (parseQuoteLineState(line.remark)) return false;
  if ((line.unit_price ?? 0) !== 0) return false;
  if (isPorMarkedLine(line)) return true;
  if (ZERO_RULE_EXEMPT_KINDS.has(line.kind)) return false;
  if (line.calculated) return false;
  if (line.optionIsCatalogZero) return false;
  if (line.unchangedZero) return false;
  return true;
}

/** 前の版と同じ明細かを比べるキー（区分・品名・説明） */
export function quoteLineIdentityKey(line: { kind: string; name: string; description?: string | null }): string {
  // SQL の btrim と同じく、前後の半角スペースだけを除いて比べる
  return `${line.kind}\u0000${btrim(line.name)}\u0000${btrim(line.description)}`;
}

export interface QuoteLineCheckLine {
  line_key?: string | null;
  kind: string;
  name: string;
  description?: string | null;
  remark?: string | null;
  unit_price: number | null | undefined;
  option_id?: string | null;
  /** 標準見積から作る下書きの価格の決め方（auto は自動計算の行） */
  price_mode?: string | null;
  /** 標準見積から作る下書きの行の役割（expense は保存のたびに作り直す経費の行） */
  line_role?: string | null;
  /** 編集中の画面の明示の選択（保存前。保存すると備考の印になる） */
  line_state?: QuoteLineState | null;
}

export interface QuoteLineCheckContext {
  /** 前の版の明細（初回は空） */
  parentLines?: QuoteLineCheckLine[];
  /**
   * 標準見積から作った初回の下書き：元の標準見積の版の 0 円の行（別途見積でないもの）。
   * 明細のキーは持ち越さないので、区分・品名・説明で突き合わせる（版の行の数まで。DB の assert_quote_draft_lines_resolved と同じ）
   */
  baselineLines?: QuoteLineCheckLine[];
  /** 商品台帳の商品（option_id から、別途見積の商品か・台帳の価格を引く） */
  options?: ReadonlyMap<string, { price: number; price_on_request: boolean }>;
  /** 下書き（quote_draft_items）は、前の版と明細のキーでも突き合わせる（DB の assert_quote_draft_lines_resolved と同じ） */
  matchLineKey?: boolean;
  /** 新しい版の行の option_id を見ない（改訂＝確定見積の明細は台帳の紐付けを残さないため。前の版の行は見る） */
  ignoreLineOptions?: boolean;
}

/** 画面の判定に使う商品台帳の商品（販売停止・非公開を含むすべて。明細が指す商品の別途見積・台帳の価格を引く） */
export interface QuoteOptionFlag {
  id: string;
  price: number;
  priceOnRequest: boolean;
}

export function quoteOptionFlagMap(flags: readonly QuoteOptionFlag[]): Map<string, { price: number; price_on_request: boolean }> {
  return new Map(flags.map((flag) => [flag.id, { price: flag.price, price_on_request: flag.priceOnRequest }]));
}

/**
 * 発行する版の明細のうち、金額未確定の行を返す（DB の assert_quote_lines_resolved・assert_quote_draft_lines_resolved と同じ決まり）。
 * 前の版の「0 円・印なし・別途見積の目印なし」の同じ明細は、変えていなければ 0 円のままでよい。ただし前の版の行の数まで
 * （同じ明細をもう 1 行足したら、足した行は未確定。並び順で後ろの行から数える）。画面の明示の選択（line_state）がある行は確定。
 */
export function findUnresolvedLines<T extends QuoteLineCheckLine>(lines: readonly T[], context: QuoteLineCheckContext = {}): Set<T> {
  const optionOf = (id: string | null | undefined) => (id ? context.options?.get(id) : undefined);
  const keyOf = (line: QuoteLineCheckLine): string | null => {
    if (!context.matchLineKey) return quoteLineIdentityKey(line);
    return line.line_key ? `${line.line_key}\u0000${quoteLineIdentityKey(line)}` : null;
  };
  // 前の版（と標準見積の版）の「変えていなければ 0 円のままでよい」明細の行の数
  const isBaseZero = (line: QuoteLineCheckLine) =>
    (line.unit_price ?? 0) === 0 &&
    !parseQuoteLineState(line.remark) &&
    !isPorMarkedLine({ ...line, optionIsPor: Boolean(optionOf(line.option_id)?.price_on_request) });
  const remaining = new Map<string, number>();
  for (const line of context.parentLines ?? []) {
    if (!isBaseZero(line)) continue;
    const key = keyOf(line);
    if (key !== null) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const baselineRemaining = new Map<string, number>();
  for (const line of context.baselineLines ?? []) {
    if (!isBaseZero(line)) continue;
    const key = quoteLineIdentityKey(line);
    baselineRemaining.set(key, (baselineRemaining.get(key) ?? 0) + 1);
  }
  const unresolved = new Set<T>();
  for (const line of lines) {
    if (line.line_state) continue;
    const option = context.ignoreLineOptions ? undefined : optionOf(line.option_id);
    const input: QuoteLineCheckInput = {
      kind: line.kind,
      unit_price: line.unit_price,
      description: line.description,
      remark: line.remark,
      optionIsPor: Boolean(option?.price_on_request),
      optionIsCatalogZero: Boolean(option && option.price === 0 && !option.price_on_request),
      calculated: line.price_mode === 'auto' && line.line_role === 'expense',
    };
    if (!isUnresolvedQuoteLine({ ...input, unchangedZero: false })) continue;
    // 別途見積の目印がある行は、前の版と同じでも未確定
    if (isUnresolvedQuoteLine({ ...input, unchangedZero: true })) {
      unresolved.add(line);
      continue;
    }
    const key = keyOf(line);
    const left = key === null ? 0 : remaining.get(key) ?? 0;
    if (key !== null && left > 0) {
      remaining.set(key, left - 1);
      continue;
    }
    const baselineKey = quoteLineIdentityKey(line);
    const baselineLeft = baselineRemaining.get(baselineKey) ?? 0;
    if (baselineLeft > 0) {
      baselineRemaining.set(baselineKey, baselineLeft - 1);
      continue;
    }
    unresolved.add(line);
  }
  return unresolved;
}

export const UNRESOLVED_LINES_MESSAGE =
  '金額を入れるか、「0円確定（理由）」か「対象外」を選ぶか、明細から外してから発行してください';

/** DB と同じ文面（ローカル検証モードの止めに使う） */
export function unresolvedLinesError(names: string[], action: '発行' | '正式保存' = '発行'): string {
  const message = UNRESOLVED_LINES_MESSAGE.replace('発行してください', `${action}してください`);
  return `金額が未確定の明細が ${names.length} 行残っています（${names.join('、').slice(0, 200)}）。${message}`;
}

export interface QuotePorSelection {
  key: string;
  option_id: string;
  name: string;
  detail: string | null;
}

export interface QuotePorSelectionState {
  selections: QuotePorSelection[];
  /** 自分（発行する担当者）の確認が、いまの一覧を覆っているか */
  confirmed: boolean;
  /** DB に確認の仕組みがあるか（migration の適用前は false。画面は発行を止める） */
  available: boolean;
  /** 一覧を読み込めなかった（画面は発行を止め、再読み込みを案内する） */
  loadError?: boolean;
}

/** 発行を止める理由（確認の仕組みが使えないとき）。使えるなら null */
export function porSelectionUnavailableReason(state: QuotePorSelectionState): string | null {
  if (state.available) return null;
  return state.loadError
    ? '金額未確定の確認の情報を読み込めませんでした。画面を再読み込みしてください'
    : 'DB の更新（金額未確定の明細の確認）が済むまで発行できません';
}

export const EMPTY_POR_SELECTION_STATE: QuotePorSelectionState = { selections: [], confirmed: false, available: false };

export function porSelectionLabel(selection: QuotePorSelection): string {
  return selection.detail ? `${selection.name}（${selection.detail}）` : selection.name;
}

export function unconfirmedPorSelectionsError(selections: QuotePorSelection[]): string {
  const names = selections.map(porSelectionLabel).join('、').slice(0, 200);
  return `お客様が選んだ別途見積の商品（${selections.length} 件：${names}）について、金額を明細に入れたか、「0円確定」「対象外」にしたか、お客様と合意のうえ外したことの確認が済んでいません。画面の「金額未確定の確認」で確認してから発行してください`;
}

export interface PorSelectionCatalog {
  options: { id: string; name: string; category_id: string; price_on_request: boolean; sort_order: number }[];
  categories: { id: string; code: string; sort_order: number }[];
  variantGroups: { id: string; option_id: string; name: string; sort_order: number }[];
  variantChoices: { id: string; group_id: string; name: string; price_on_request: boolean; sort_order: number }[];
}

/** configuration_por_selections の TypeScript 版（ローカル検証モード用。並び順も DB と同じ） */
export function configurationPorSelections(
  input: {
    items: { option_id: string; variant_choice_ids?: string[] | null }[];
    exteriorFaces?: ExteriorFaceSelection[] | null;
  },
  catalog: PorSelectionCatalog
): QuotePorSelection[] {
  const optionById = new Map(catalog.options.map((option) => [option.id, option]));
  const categoryById = new Map(catalog.categories.map((category) => [category.id, category]));
  const groupById = new Map(catalog.variantGroups.map((group) => [group.id, group]));
  const choiceById = new Map(catalog.variantChoices.map((choice) => [choice.id, choice]));
  const faces = input.exteriorFaces ?? [];
  const hasFaces = faces.length === 4;

  type Row = QuotePorSelection & { sort: number[] };
  const rows: Row[] = [];

  for (const item of input.items) {
    const option = optionById.get(item.option_id);
    const category = option ? categoryById.get(option.category_id) : undefined;
    if (!option || !category) continue;
    // 外壁を面ごとに選んだ構成では、外壁の商品は面の選択として数える
    if (hasFaces && category.code === 'exterior-wall') continue;
    if (option.price_on_request) {
      rows.push({ key: `product:${option.id}`, option_id: option.id, name: option.name, detail: null, sort: [0, category.sort_order, option.sort_order, 0] });
    }
    for (const choiceId of item.variant_choice_ids ?? []) {
      const choice = choiceById.get(choiceId);
      const group = choice ? groupById.get(choice.group_id) : undefined;
      if (!choice || !group || !choice.price_on_request || group.option_id !== option.id) continue;
      rows.push({
        key: `variant:${option.id}:${choice.id}`,
        option_id: option.id,
        name: option.name,
        detail: `${group.name}：${choice.name}`,
        sort: [0, category.sort_order, option.sort_order, 1 + group.sort_order * 10000 + choice.sort_order],
      });
    }
  }

  if (hasFaces) {
    faces.forEach((face, index) => {
      const option = optionById.get(face.option_id);
      if (!option) return;
      const porChoices = (face.variant_choice_ids ?? [])
        .map((id) => choiceById.get(id))
        .filter((choice): choice is NonNullable<typeof choice> => Boolean(choice?.price_on_request))
        .map((choice) => ({ choice, group: groupById.get(choice.group_id) }))
        .filter((row): row is { choice: typeof row.choice; group: NonNullable<typeof row.group> } => row.group?.option_id === option.id)
        .sort((a, b) => a.group.sort_order - b.group.sort_order || a.choice.sort_order - b.choice.sort_order);
      if (!option.price_on_request && porChoices.length === 0) return;
      const label = exteriorFaceLabel(face.face_code);
      const labels = porChoices.map(({ group, choice }) => `${group.name}：${choice.name}`).join('／');
      // キーには別途見積の選択肢の ID も入れる（DB と同じ。同じ面・同じ商品でも選択肢が変われば確認し直す）
      const choiceIds = porChoices.map(({ choice }) => choice.id).sort();
      rows.push({
        key: `face:${face.face_code}:${option.id}${choiceIds.length > 0 ? `:${choiceIds.join(',')}` : ''}`,
        option_id: option.id,
        name: option.name,
        detail: `外壁（${label}）${labels ? `：${labels}` : ''}`,
        sort: [1, 0, index + 1, 0],
      });
    });
  }

  rows.sort((a, b) => {
    for (let i = 0; i < a.sort.length; i += 1) {
      if (a.sort[i] !== b.sort[i]) return a.sort[i] - b.sort[i];
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return rows.map((row) => ({ key: row.key, option_id: row.option_id, name: row.name, detail: row.detail }));
}

/** 画面に出した一覧と、いまの一覧が同じか（順番は問わない。DB の確認の RPC と同じ比べ方） */
export function samePorSelectionKeys(given: readonly string[], current: readonly QuotePorSelection[]): boolean {
  const a = [...new Set(given)].sort();
  const b = [...new Set(current.map((selection) => selection.key))].sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
