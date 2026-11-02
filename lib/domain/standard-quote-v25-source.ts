import type { QuoteLineCheckLine } from './quote-por';

/**
 * v2.5 の標準見積の版から作る見積下書き（Web 以外。v2.5 PR-D1c）の元の明細。
 * 品名・見出しは DB の standard_estimate_v25_quote_draft_lines と同じ（Web の第 1 版の見積とも同じ）。
 */

/** 版の選択枠（標準状態の商品）のうち、品名・見出し・0 円の判定に使う列 */
export interface V25SourceSlot {
  section_code: string;
  option_name_snapshot: string;
  category_name_snapshot: string;
  slot_label: string | null;
  price_mode: string | null;
  cost_unit_price: number | null;
  manual_unit_price: number | null;
  /** 選んだ仕様（選択肢の名前の写し）。並び順の値つき */
  variants: { variant_choice_name_snapshot: string; sort_order: number }[];
}

/** 版の商品に紐づかない明細（manual / por） */
export interface V25SourceLine {
  section_code: string;
  name: string;
  group_label: string | null;
  remark: string | null;
  price_mode: string;
  unit_price: number | null;
}

/** 見積の明細の品名は 120 文字まで（DB と同じく、超えたら 119 文字＋「…」） */
const LINE_NAME_MAX = 120;

const SECTION_KIND: Record<string, string> = { interior_exterior: 'interior_exterior', option: 'option', sitework: 'installation' };

/** 選択枠の品名：「商品名 ／ 仕様・仕様」 */
export function v25SourceSlotName(slot: Pick<V25SourceSlot, 'option_name_snapshot' | 'variants'>): string {
  const names = [...slot.variants].sort((a, b) => a.sort_order - b.sort_order).map((variant) => variant.variant_choice_name_snapshot);
  const full = names.length > 0 ? `${slot.option_name_snapshot} ／ ${names.join('・')}` : slot.option_name_snapshot;
  const chars = Array.from(full);
  return chars.length > LINE_NAME_MAX ? `${chars.slice(0, LINE_NAME_MAX - 1).join('')}…` : full;
}

/** 選択枠の見出し：「カテゴリー」、位置・用途の枠は「カテゴリー（位置）」 */
export function v25SourceSlotGroupLabel(slot: Pick<V25SourceSlot, 'category_name_snapshot' | 'slot_label'>): string {
  return slot.slot_label ? `${slot.category_name_snapshot}（${slot.slot_label}）` : slot.category_name_snapshot;
}

/**
 * 版の 0 円の明細。初回の下書きで、変えていなければ金額未確定として止めない行
 * （DB の assert_quote_draft_lines_resolved の v2.5 の版の分と同じ。別途見積の目印・明示の状態は findUnresolvedLines が外す）
 */
export function v25SourceZeroLines(slots: readonly V25SourceSlot[], lines: readonly V25SourceLine[]): QuoteLineCheckLine[] {
  const zeroSlots = slots.flatMap((slot): QuoteLineCheckLine[] => {
    const kind = SECTION_KIND[slot.section_code];
    const zero =
      slot.price_mode === 'auto' ? (slot.cost_unit_price ?? 0) === 0 : slot.price_mode === 'manual' && (slot.manual_unit_price ?? 0) === 0;
    return kind && zero ? [{ kind, name: v25SourceSlotName(slot), description: v25SourceSlotGroupLabel(slot), remark: null, unit_price: 0 }] : [];
  });
  const zeroLines = lines.flatMap((line): QuoteLineCheckLine[] => {
    const kind = SECTION_KIND[line.section_code];
    return kind && line.price_mode === 'manual' && (line.unit_price ?? 0) === 0
      ? [{ kind, name: line.name, description: line.group_label, remark: line.remark, unit_price: 0 }]
      : [];
  });
  return [...zeroSlots, ...zeroLines];
}
