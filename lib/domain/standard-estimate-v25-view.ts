/**
 * 標準見積の v2.5 の編集画面（PR-B1b）で使う型・保存内容の組み立て・入力の確認。
 * 金額・原価 Version の固定・公開の可否の正本は DB（save / refresh / publish / preview_standard_estimate_v25_revision）。
 * ここは画面の状態を RPC の形に変え、DB と同じ入力の決まりを先に案内するだけ（金額は計算しない）。
 */
import type { StandardLineSectionCode } from './standard-estimate-view';

export type V25SlotPriceMode = 'auto' | 'manual' | 'por';
export type V25LinePriceMode = 'manual' | 'por';
export type V25CostStatus = 'current' | 'stale' | 'missing';

export const V25_SLOT_PRICE_MODE_LABEL: Record<V25SlotPriceMode, string> = {
  auto: '自動（商品の標準原価から計算）',
  manual: '売価を入力（税別・経費別）',
  por: '別途見積（金額未確定）',
};

export const V25_LINE_PRICE_MODE_LABEL: Record<V25LinePriceMode, string> = {
  manual: '金額確定（売価を入力）',
  por: '別途見積（金額未確定）',
};

export const V25_COST_STATUS_LABEL: Record<V25CostStatus, string> = {
  current: '最新の原価',
  stale: '原価が更新されています',
  missing: '原価が未設定です',
};

/** 率の範囲（DB の save_standard_estimate_v25_draft と同じ） */
export const V25_RATE_RULES = {
  sales_fee_rate: { min: 1, max: 1.5, label: '販売費率' },
  expense_rate: { min: 0, max: 0.3, label: '経費率' },
  markup_rate: { min: 1, max: 2.5, label: '掛率' },
} as const;

/** 商品の選択枠（画面の 1 行） */
export interface V25SlotRow {
  /** 画面の行の識別子（React の key） */
  key: string;
  /** 保存済みの選択枠の識別子（新しい行は null） */
  baseline_key: string | null;
  option_id: string;
  /** 選択項目ごとの選択肢（group_id → choice_id） */
  variant_choices: Record<string, string>;
  quantity: string;
  price_mode: V25SlotPriceMode;
  /** manual のときの売価単価（税別・経費別）。入力中の文字列 */
  manual_unit_price: string;
}

/** 商品に紐づかない明細（工事費など） */
export interface V25LineRow {
  key: string;
  line_key: string | null;
  section_code: StandardLineSectionCode;
  group_label: string;
  name: string;
  quantity: string;
  unit: string;
  price_mode: V25LinePriceMode;
  unit_price: string;
  remark: string;
  review_required: boolean;
}

export interface V25EditorState {
  sales_fee_rate: string;
  markup_rate: string;
  expense_rate: string;
  adjustment: string;
  adjustment_reason: string;
  slots: V25SlotRow[];
  lines: V25LineRow[];
}

/** 商品の候補（その仕様でお客様が選べる、取扱中の商品。選択肢は公開中のものだけ） */
export interface V25ProductCandidate {
  id: string;
  name: string;
  categoryName: string;
  section: StandardLineSectionCode;
  /** 取扱終了。この Revision に保存済みの行だけを表示・保持のために渡す */
  retired?: boolean;
  variantGroups: { id: string; name: string; choices: { id: string; name: string }[] }[];
}

/** 編集画面の確認（preview_standard_estimate_v25_revision の結果のうち、画面で使う部分） */
export interface V25PreviewSlot {
  baseline_key: string;
  option_id: string;
  name: string;
  price_mode: V25SlotPriceMode;
  cost_status: V25CostStatus | null;
  variants: { variant_choice_id: string; status: V25CostStatus | null }[];
}

export interface V25Preview {
  rules_current: boolean;
  /** v2.5 以前から引き継いだ明細のうち「要見直し」が残っている行数（1 行でもあれば公開できない） */
  review_required_lines?: number;
  publishable: boolean;
  calc_error: string | null;
  incomplete: { option_id: string; name: string; reason: 'missing_standard_cost' | 'missing_variant_cost' }[];
  slots: V25PreviewSlot[];
}

const DECIMAL_4 = /^\d+(\.\d{1,4})?$/;
const INTEGER = /^-?\d+$/;
const NON_NEGATIVE_INTEGER = /^\d+$/;

function decimalOk(value: string): boolean {
  return DECIMAL_4.test(value.trim());
}

/** 選択枠の状態（選択肢を含む）のうち、もっとも悪いもの（公開できない理由の表示に使う） */
export function slotCostStatus(slot: V25PreviewSlot | undefined): V25CostStatus | null {
  if (!slot || slot.price_mode !== 'auto') return null;
  const statuses = [slot.cost_status, ...slot.variants.map((variant) => variant.status)];
  if (statuses.includes('missing')) return 'missing';
  if (statuses.includes('stale')) return 'stale';
  return slot.cost_status ?? null;
}

/** DB と同じ入力の決まりを先に確かめる。問題があれば最初の 1 件を返す（null なら保存へ進める）。
 *  sectionOf は商品の区分（別途工事の商品は自動計算にできない：2026-10-19 の確定方針） */
export function validateV25EditorState(
  state: V25EditorState,
  sectionOf: (optionId: string) => StandardLineSectionCode | undefined = () => undefined
): string | null {
  for (const key of ['sales_fee_rate', 'markup_rate', 'expense_rate'] as const) {
    const rule = V25_RATE_RULES[key];
    const raw = state[key].trim();
    if (!decimalOk(raw)) return `${rule.label}は小数 4 桁までの数で入力してください`;
    const value = Number(raw);
    if (value < rule.min || value > rule.max) return `${rule.label}は ${rule.min * 100}〜${rule.max * 100}% の範囲で入力してください`;
  }
  const adjustment = state.adjustment.trim() || '0';
  if (!INTEGER.test(adjustment)) return '調整額は整数円で入力してください';
  if (Number(adjustment) !== 0 && !state.adjustment_reason.trim()) return '調整額を入れる場合は理由を入力してください';
  if (state.slots.length > 200) return '商品は 200 件までです';
  if (state.lines.length > 300) return '明細は 300 行までです';

  const seen = new Set<string>();
  for (const [index, slot] of state.slots.entries()) {
    const label = `商品 ${index + 1} 件目`;
    if (!slot.option_id) return `${label}の商品を選んでください`;
    if (seen.has(slot.option_id)) return `${label}：同じ商品が重複しています`;
    seen.add(slot.option_id);
    if (!decimalOk(slot.quantity) || Number(slot.quantity) <= 0 || Number(slot.quantity) > 99999) {
      return `${label}の数量は 0 より大きく 99999 以下・小数 4 桁以内で入力してください`;
    }
    if (slot.price_mode === 'manual' && !NON_NEGATIVE_INTEGER.test(slot.manual_unit_price.trim())) {
      return `${label}の売価単価（税別・経費別、0 円以上の整数）を入力してください`;
    }
    if (slot.price_mode === 'auto' && sectionOf(slot.option_id) === 'sitework') {
      return `${label}：別途工事の商品は自動計算（販売費・掛率）にできません。決めた税別売価を入力するか、別途見積にしてください`;
    }
  }
  for (const [index, line] of state.lines.entries()) {
    const label = `明細 ${index + 1} 行目`;
    if (!line.name.trim() || line.name.trim().length > 120) return `${label}の品名は 1〜120 文字で入力してください`;
    if (!decimalOk(line.quantity) || Number(line.quantity) <= 0 || Number(line.quantity) > 99999) {
      return `${label}の数量は 0 より大きく 99999 以下・小数 4 桁以内で入力してください`;
    }
    if (line.unit.trim().length > 40) return `${label}の単位は 40 文字までです`;
    if (line.price_mode === 'manual' && !NON_NEGATIVE_INTEGER.test(line.unit_price.trim())) {
      return `${label}の売価単価（税別・経費別、0 円以上の整数）を入力してください`;
    }
  }
  return null;
}

/** 画面の状態を save_standard_estimate_v25_draft の p_payload にする（選択肢は選択項目の順に並べる） */
export function buildV25SavePayload(state: V25EditorState) {
  return {
    rates: {
      sales_fee_rate: state.sales_fee_rate.trim(),
      markup_rate: state.markup_rate.trim(),
      expense_rate: state.expense_rate.trim(),
    },
    adjustment: Number(state.adjustment.trim() || '0'),
    adjustment_reason: state.adjustment_reason.trim() || null,
    slots: state.slots.map((slot) => ({
      baseline_key: slot.baseline_key,
      option_id: slot.option_id,
      variant_choice_ids: Object.values(slot.variant_choices).filter(Boolean),
      quantity: slot.quantity.trim(),
      price_mode: slot.price_mode,
      manual_unit_price: slot.price_mode === 'manual' ? Number(slot.manual_unit_price.trim()) : null,
    })),
    lines: state.lines.map((line) => ({
      line_key: line.line_key,
      section_code: line.section_code,
      group_label: line.group_label.trim() || null,
      name: line.name.trim(),
      quantity: line.quantity.trim(),
      unit: line.unit.trim() || null,
      price_mode: line.price_mode,
      unit_price: line.price_mode === 'manual' ? Number(line.unit_price.trim()) : null,
      remark: line.remark.trim() || null,
      review_required: line.review_required,
    })),
  };
}

/** 公開できない理由（編集画面に並べる）。DB の公開の確認と同じ観点 */
export function v25PublishBlockers(preview: V25Preview | null, dirty: boolean): string[] {
  const blockers: string[] = [];
  if (dirty) blockers.push('保存していない変更があります。保存してから公開してください');
  if (!preview) return [...blockers, '金額を確認できませんでした。再読み込みしてください'];
  if (!preview.rules_current) blockers.push('計算ルール・税ルールが更新されています。最新原価を取り込んでください');
  if ((preview.review_required_lines ?? 0) > 0) {
    blockers.push(`「要見直し」の明細が ${preview.review_required_lines} 行残っています。商品台帳の商品に置き換えるか、金額を確認して見直し済みにしてください`);
  }
  for (const item of preview.incomplete) {
    blockers.push(
      item.reason === 'missing_standard_cost'
        ? `「${item.name}」の商品の標準原価が未設定です（商品台帳で設定するか、売価を入力・別途見積にしてください）`
        : `「${item.name}」の選んだ選択肢の標準原価調整額が未設定です（0 円でも設定が必要です）`
    );
  }
  const stale = preview.slots.filter((slot) => slotCostStatus(slot) === 'stale').map((slot) => `「${slot.name}」`);
  if (stale.length) blockers.push(`${stale.join('・')}の原価が更新されています。最新原価を取り込んで金額を確認してください`);
  if (preview.calc_error) blockers.push(preview.calc_error.replace(/^(VALIDATION|LOCKED):\s*/, ''));
  return blockers;
}
