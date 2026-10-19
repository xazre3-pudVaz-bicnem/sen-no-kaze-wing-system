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
  const [slotsResult, linesResult, previewResult, calcResult, taxResult] = await Promise.all([
    supabase
      .from('standard_estimate_revision_baseline_items')
      .select('id, baseline_key, option_id, quantity, price_mode, manual_unit_price, sale_unit_price, amount, sort_order, standard_estimate_revision_baseline_variants(variant_group_id, variant_choice_id, sort_order)')
      .eq('revision_id', revision.id)
      .order('sort_order'),
    supabase
      .from('standard_estimate_revision_v25_lines')
      .select('line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order')
      .eq('revision_id', revision.id)
      .order('sort_order'),
    supabase.rpc('preview_standard_estimate_v25_revision', { p_revision_id: revision.id }),
    header.calc_rule_version_id
      ? supabase.from('pricing_calculation_rule_versions').select('code').eq('id', header.calc_rule_version_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    header.tax_rule_version_id
      ? supabase.from('tax_rule_versions').select('code, tax_rate').eq('id', header.tax_rule_version_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (slotsResult.error) throw new Error(`標準見積の商品を取得できませんでした: ${slotsResult.error.code ?? 'unknown'}`);
  if (linesResult.error && !isMissingRelation(linesResult.error)) {
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
  };
  const slots = (slotsResult.data ?? []) as unknown as SlotRow[];
  const lines = (linesResult.error ? [] : (linesResult.data ?? [])) as unknown as LineRow[];

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
    })),
  };

  return {
    initial,
    savedSlotAmounts: Object.fromEntries(slots.map((slot) => [slot.baseline_key, { amount: slot.amount, sale_unit_price: slot.sale_unit_price }])),
    savedLineAmounts: Object.fromEntries(lines.map((line) => [line.line_key, line.amount])),
    preview: previewUnavailable ? null : ((previewResult.data ?? null) as V25Preview | null),
    slotOptionIds: slots.map((slot) => slot.option_id),
    rules: {
      calcCode: (calcResult.data as { code?: string } | null)?.code ?? null,
      taxCode: (taxResult.data as { code?: string } | null)?.code ?? null,
      taxRate: (taxResult.data as { tax_rate?: number | string } | null)?.tax_rate != null
        ? String((taxResult.data as { tax_rate: number | string }).tax_rate)
        : null,
    },
  };
}
