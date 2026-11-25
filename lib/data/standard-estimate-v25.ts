import 'server-only';
import { isMissingColumn, isMissingFunction, isMissingRelation } from '@/lib/data/schema-compat';
import type { createClient } from '@/lib/supabase/server';
import type { StandardLineSectionCode } from '@/lib/domain/standard-estimate-view';
import type {
  V25EditorState,
  V25LinePriceMode,
  V25Preview,
  V25SlotPriceMode,
} from '@/lib/domain/standard-estimate-v25-view';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type StandardEstimateV25Header = {
  pricing_model: 'legacy' | 'v2.5';
  calc_rule_version_id: string | null;
  tax_rule_version_id: string | null;
  v25_pricing_complete: boolean | null;
};

/** v2.5 の列（20261019100000）を読む。DB にまだ無ければ v2.5 は使えない（null） */
export async function getStandardEstimateV25Header(supabase: SupabaseClient, revisionId: string): Promise<StandardEstimateV25Header | null> {
  const { data, error } = await supabase
    .from('standard_estimate_revisions')
    .select('pricing_model, calc_rule_version_id, tax_rule_version_id, v25_pricing_complete')
    .eq('id', revisionId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error)) return null;
    throw new Error(`標準見積の計算の方式を取得できませんでした: ${error.code ?? 'unknown'}`);
  }
  if (!data) return null;
  return {
    pricing_model: data.pricing_model === 'v2.5' ? 'v2.5' : 'legacy',
    calc_rule_version_id: data.calc_rule_version_id ?? null,
    tax_rule_version_id: data.tax_rule_version_id ?? null,
    v25_pricing_complete: data.v25_pricing_complete ?? null,
  };
}

export type StandardEstimateV25Data = {
  initial: V25EditorState;
  /** 手入力明細の原価単価の列を読めたか（20261110150000 の後の DB）。false なら画面は原価の欄を出さない */
  lineCostsAvailable: boolean;
  savedSlotAmounts: Record<string, { amount: number | null; sale_unit_price: number | null }>;
  savedLineAmounts: Record<string, number | null>;
  preview: V25Preview | null;
  slotOptionIds: string[];
  rules: { calcCode: string | null; taxCode: string | null; taxRate: string | null };
};

/** v2.5 の Revision の編集に必要な内容（選択枠・明細・確認）。金額・原価の新しさは DB の値をそのまま使う */
export async function loadStandardEstimateV25(
  supabase: SupabaseClient,
  revision: { id: string; sales_fee_rate: number | string; markup_rate: number | string; expense_rate: number | string; standard_adjustment_amount: number; standard_adjustment_reason: string | null },
  header: StandardEstimateV25Header
): Promise<StandardEstimateV25Data> {
  // 位置・用途の選択枠（v2.5 PR-S1。20261102100000）の列と、枠ごとの選べる商品も読む。migration が無い DB では読まずに続ける
  // 混在の並び順・工事項目（2026-11-16 の先方の依頼。20261110140000）の列も読む。migration が無い DB では読まずに続ける
  const slotColumns = (withPositions: boolean, withRowOrder: boolean) =>
    `id, baseline_key, option_id, quantity, price_mode, manual_unit_price, sale_unit_price, amount, sort_order,${withPositions ? ' slot_code, slot_label,' : ''}${withRowOrder ? ' display_order, work_item,' : ''} standard_estimate_revision_baseline_variants(variant_group_id, variant_choice_id, sort_order)`;
  const readSlots = (withPositions: boolean, withRowOrder: boolean) =>
    supabase
      .from('standard_estimate_revision_baseline_items')
      .select(slotColumns(withPositions, withRowOrder))
      .eq('revision_id', revision.id)
      .order('sort_order');
  // 手入力明細の原価単価（2026-11-20 の先方の依頼。20261110150000）の列も読む。migration が無い DB では読まずに続ける
  const lineColumns = (withRowOrder: boolean, withCost: boolean) =>
    `line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order${withRowOrder ? ', display_order' : ''}${withCost ? ', cost_unit_price' : ''}`;
  const readLines = (withRowOrder: boolean, withCost: boolean) =>
    supabase
      .from('standard_estimate_revision_v25_lines')
      .select(lineColumns(withRowOrder, withCost))
      .eq('revision_id', revision.id)
      .order('sort_order');
  const [firstSlotsResult, slotOptionsResult, firstLinesResult, previewResult, calcResult, taxResult] = await Promise.all([
    readSlots(true, true),
    supabase
      .from('standard_estimate_revision_slot_options')
      .select('slot_code, option_id, sort_order')
      .eq('revision_id', revision.id)
      .order('sort_order'),
    readLines(true, true),
    supabase.rpc('preview_standard_estimate_v25_revision', { p_revision_id: revision.id }),
    header.calc_rule_version_id
      ? supabase.from('pricing_calculation_rule_versions').select('code').eq('id', header.calc_rule_version_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    header.tax_rule_version_id
      ? supabase.from('tax_rule_versions').select('code, tax_rate').eq('id', header.tax_rule_version_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  // 並び順・工事項目の列が無ければそれを除いて、位置の列も無ければさらに除いて読み直す。
  // 列が無いことの判定は、コードと「column … does not exist」の両方で行う（表が無い扱いにして明細を空で読むと、次の保存で消えるため）
  const missingColumn = (error: { code?: string; message?: string } | null | undefined) =>
    isMissingColumn(error) || /column .* does not exist/i.test(error?.message ?? '');
  let slotsResult = firstSlotsResult;
  if (slotsResult.error && missingColumn(slotsResult.error)) slotsResult = await readSlots(true, false);
  if (slotsResult.error && missingColumn(slotsResult.error)) slotsResult = await readSlots(false, false);
  let linesResult = firstLinesResult;
  // 原価の列を読めたか（20261110150000 の後か）。読めなければ画面は原価の欄を出さず、保存でも原価の項目を送らない
  // （migration の前の DB で原価を入れても捨てられ、粗利を原価 0 円として出すのを防ぐ。独立レビューの指摘）
  let lineCostsAvailable = true;
  if (linesResult.error && missingColumn(linesResult.error)) {
    lineCostsAvailable = false;
    linesResult = await readLines(true, false);
  }
  if (linesResult.error && missingColumn(linesResult.error)) linesResult = await readLines(false, false);
  if (slotsResult.error) throw new Error(`標準見積の商品を取得できませんでした: ${slotsResult.error.code ?? 'unknown'}`);
  if (slotOptionsResult.error && !isMissingRelation(slotOptionsResult.error)) {
    throw new Error(`標準見積の選べる商品を取得できませんでした: ${slotOptionsResult.error.code ?? 'unknown'}`);
  }
  if (linesResult.error && (missingColumn(linesResult.error) || !isMissingRelation(linesResult.error))) {
    throw new Error(`標準見積の明細を取得できませんでした: ${linesResult.error.code ?? 'unknown'}`);
  }
  const previewUnavailable = previewResult.error && isMissingFunction(previewResult.error);
  if (previewResult.error && !previewUnavailable) {
    throw new Error(`標準見積の金額を確認できませんでした: ${previewResult.error.code ?? 'unknown'}`);
  }

  type SlotRow = {
    baseline_key: string;
    option_id: string;
    quantity: number | string;
    price_mode: V25SlotPriceMode | null;
    manual_unit_price: number | null;
    sale_unit_price: number | null;
    amount: number | null;
    slot_code?: string | null;
    slot_label?: string | null;
    display_order?: number | null;
    work_item?: string | null;
    standard_estimate_revision_baseline_variants: { variant_group_id: string; variant_choice_id: string; sort_order: number }[] | null;
  };
  type LineRow = {
    line_key: string;
    section_code: StandardLineSectionCode;
    group_label: string | null;
    name: string;
    quantity: number | string;
    unit: string | null;
    price_mode: V25LinePriceMode;
    unit_price: number | null;
    amount: number | null;
    remark: string | null;
    review_required: boolean;
    display_order?: number | null;
    cost_unit_price?: number | null;
  };
  const slots = (slotsResult.data ?? []) as unknown as SlotRow[];
  const lines = (linesResult.error ? [] : (linesResult.data ?? [])) as unknown as LineRow[];
  const slotOptions = (slotOptionsResult.error ? [] : (slotOptionsResult.data ?? [])) as unknown as { slot_code: string; option_id: string; sort_order: number }[];
  const selectableOf = (slotCode: string | null | undefined) =>
    slotCode ? slotOptions.filter((row) => row.slot_code === slotCode).sort((a, b) => a.sort_order - b.sort_order).map((row) => row.option_id) : [];

  const initial: V25EditorState = {
    sales_fee_rate: String(revision.sales_fee_rate),
    markup_rate: String(revision.markup_rate),
    expense_rate: String(revision.expense_rate),
    adjustment: String(revision.standard_adjustment_amount),
    adjustment_reason: revision.standard_adjustment_reason ?? '',
    slots: slots.map((slot) => ({
      key: `slot-${slot.baseline_key}`,
      baseline_key: slot.baseline_key,
      option_id: slot.option_id,
      variant_choices: Object.fromEntries(
        [...(slot.standard_estimate_revision_baseline_variants ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((variant) => [variant.variant_group_id, variant.variant_choice_id])
      ),
      quantity: String(Number(slot.quantity)),
      price_mode: slot.price_mode ?? 'auto',
      manual_unit_price: slot.manual_unit_price === null ? '' : String(slot.manual_unit_price),
      slot_code: slot.slot_code ?? '',
      slot_label: slot.slot_label ?? '',
      selectable_option_ids: selectableOf(slot.slot_code),
      // 並び順と工事項目（2026-11-16 の先方の依頼。保存前の下書きは null と ''）
      row_order: slot.display_order ?? null,
      work_item: slot.work_item ?? '',
    })),
    lines: lines.map((line) => ({
      key: `line-${line.line_key}`,
      line_key: line.line_key,
      section_code: line.section_code,
      group_label: line.group_label ?? '',
      name: line.name,
      quantity: String(Number(line.quantity)),
      unit: line.unit ?? '',
      price_mode: line.price_mode,
      unit_price: line.unit_price === null ? '' : String(line.unit_price),
      remark: line.remark ?? '',
      review_required: line.review_required,
      row_order: line.display_order ?? null,
      // 原価単価（空は原価未設定。0 円は "0"）。原価の列が無い DB では持たない（保存で項目を送らず、DB の今の値を残す）
      ...(lineCostsAvailable
        ? { cost_unit_price: line.cost_unit_price === null || line.cost_unit_price === undefined ? '' : String(line.cost_unit_price) }
        : {}),
    })),
  };

  return {
    initial,
    lineCostsAvailable,
    savedSlotAmounts: Object.fromEntries(slots.map((slot) => [slot.baseline_key, { amount: slot.amount, sale_unit_price: slot.sale_unit_price }])),
    savedLineAmounts: Object.fromEntries(lines.map((line) => [line.line_key, line.amount])),
    preview: previewUnavailable ? null : ((previewResult.data ?? null) as V25Preview | null),
    // 保存済みの行の商品と、位置の枠の選べる商品（販売停止になっても表示・削除のために候補に残す）
    slotOptionIds: [...new Set([...slots.map((slot) => slot.option_id), ...slotOptions.map((row) => row.option_id)])],
    rules: {
      calcCode: (calcResult.data as { code?: string } | null)?.code ?? null,
      taxCode: (taxResult.data as { code?: string } | null)?.code ?? null,
      taxRate: (taxResult.data as { tax_rate?: number | string } | null)?.tax_rate != null
        ? String((taxResult.data as { tax_rate: number | string }).tax_rate)
        : null,
    },
  };
}
