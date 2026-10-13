/**
 * 新しい標準見積（売価だけの形、get_standard_estimate_sale_views）でシミュレーターの価格を計算する（PR C2）。
 * DB の見積依頼（recalculate_configuration・create_quote_from_configuration の標準見積の分岐）と同じ式。
 *
 *   区分の明細小計 = 標準見積の明細小計 ＋（選んだ商品の価格の合計 − 標準状態の商品の価格の合計）
 *     選んだ商品：商品台帳の現在の価格（バリエーション・外壁 4 面を含む。旧来の computePricing と同じ）
 *     標準状態の商品：公開時に確定した価格 × 数量（外壁は 4 面分）。すべて trunc
 *   区分の経費 = trunc(区分の明細小計 × 経費率)（経費の方法が「率」の区分だけ。本体は標準見積のまま）
 *   税抜 = 区分の合計 ＋ 標準見積の調整額、税 = trunc(税抜 × 税率)。旧来の 1,000 円未満切り捨ては持ち込まない
 *
 * 使うのは、標準状態の商品が登録された公開中の標準見積で、機種・用途・防火がちょうど 1 件に決まるときだけ。
 * それ以外は従来の計算のまま（呼び出し側で判断する）。
 */
import { computePricing } from './pricing';
import { truncMul, truncQuantity } from './standard-estimate-money';
import type { StandardEstimatePricingResult, StandardEstimateSectionPricing } from './standard-estimate-pricing';
import { INTERIOR_EXTERIOR_CATEGORY_CODES } from './standard-estimate-pricing';
import type { ExteriorFaceSelection } from './exterior-wall';
import type { CatalogBundle, EstimateSectionCode, EstimateTemplateBundle, PricingResult } from './types';

type LineSection = Exclude<EstimateSectionCode, 'base'>;

export interface StandardEstimateSaleViewSection {
  code: EstimateSectionCode;
  expense_method: 'rate' | 'none' | 'fixed';
  line_subtotal: number;
  expense_amount: number;
  total: number;
  has_por: boolean;
}

export interface StandardEstimateSaleView {
  revision_id: string;
  version: number;
  base_model_id: string;
  spec_code: string;
  size_code: string;
  fire_spec_code: 'non_fire' | 'fire';
  tax_rate: number | string;
  expense_rate: number | string;
  subtotal_raw: number;
  adjustment: number;
  subtotal: number;
  tax: number;
  total: number;
  has_por: boolean;
  sections: StandardEstimateSaleViewSection[];
  base_lines: Array<{ section: string; name: string; quantity: number | string; unit: string | null; unit_price: number; amount: number }>;
  lines: Array<{
    section_code: LineSection;
    group_label: string | null;
    name: string;
    quantity: number | string;
    unit: string | null;
    unit_price: number | null;
    amount: number | null;
    is_por: boolean;
  }>;
  baseline: Array<{
    option_id: string;
    section_code: LineSection;
    selection_target_code: string;
    quantity: number | string;
    unit_price: number;
    price_on_request: boolean;
    variant_choice_ids: string[];
    variant_extra: number;
  }>;
}

const SECTION_LABEL: Record<EstimateSectionCode, string> = {
  base: '本体',
  interior_exterior: '内外装工事',
  option: 'オプション',
  sitework: '別途工事',
};

/** 防火仕様を選んでいるか（旧来の「防火仕様」カテゴリーの fire-proof） */
export const FIRE_PROOF_OPTION_CODE = 'fire-proof';

/** シミュレーターの用途コードを、標準見積（仕様マトリクス）の用途コードへ寄せる。BOX の hotel-single は BOX ホテル仕様（互換） */
export function saleViewSpecCode(modelSlug: string, specCode: string): string {
  return modelSlug === 'box' && specCode === 'hotel-single' ? 'hotel' : specCode;
}

/**
 * 使う標準見積を 1 件に決める。標準状態の商品が無い・候補が 0 件または複数（サイズ違い）なら null（従来の計算）。
 * 防火を選んでいても防火の標準見積が無ければ、非防火の標準見積を使い、防火は従来どおり別途見積のまま残す。
 */
export function pickSaleView(
  views: StandardEstimateSaleView[],
  modelSlug: string,
  specCode: string,
  fireSelected: boolean
): StandardEstimateSaleView | null {
  const spec = saleViewSpecCode(modelSlug, specCode);
  const usable = views.filter((view) => view.spec_code === spec && view.baseline.length > 0);
  const pick = (fire: 'non_fire' | 'fire') => {
    const matches = usable.filter((view) => view.fire_spec_code === fire);
    return matches.length === 1 ? matches[0] : null;
  };
  return (fireSelected ? pick('fire') : null) ?? pick('non_fire');
}

function sectionForLine(line: PricingResult['lines'][number]): LineSection {
  if (line.is_installation || line.is_free_product) return 'sitework';
  return INTERIOR_EXTERIOR_CATEGORY_CODES.has(line.category_code) ? 'interior_exterior' : 'option';
}

/** 標準状態の商品の区分ごとの合計（公開時の価格 × 数量。外壁は 4 面分。trunc） */
export function baselineSectionTotal(view: StandardEstimateSaleView, section: LineSection): number {
  return view.baseline
    .filter((item) => item.section_code === section)
    .reduce((sum, item) => {
      const unit = (item.price_on_request ? 0 : item.unit_price) + item.variant_extra;
      const faces = item.selection_target_code === 'exterior-wall' ? 4 : 1;
      return sum + truncQuantity(item.quantity, unit) * faces;
    }, 0);
}

/** 画面の見積書の表示用に、売価だけの標準見積を従来のテンプレートと同じ形にする */
export function saleViewToTemplateBundle(view: StandardEstimateSaleView, modelId: string): EstimateTemplateBundle {
  const sections = (['base', 'interior_exterior', 'option', 'sitework'] as const).map((code, index) => {
    const section = view.sections.find((row) => row.code === code);
    return {
      id: `${view.revision_id}-${code}`,
      template_id: view.revision_id,
      code,
      label: SECTION_LABEL[code],
      line_subtotal: section?.line_subtotal ?? 0,
      expense_label: section?.expense_method === 'rate' ? '経費' : null,
      expense_rate: section?.expense_method === 'rate' ? Number(view.expense_rate) : null,
      expense_amount: section?.expense_amount ?? 0,
      total: section?.total ?? 0,
      sort_order: index,
    };
  });
  return {
    template: {
      id: view.revision_id,
      base_model_id: modelId,
      spec_code: view.spec_code,
      name: '',
      source_file_name: '',
      source_sheet_name: '',
      source_sha256: '',
      baseline_option_ids: view.baseline.map((item) => item.option_id),
      tax_rate: Number(view.tax_rate),
      subtotal_raw: view.subtotal_raw,
      adjustment: view.adjustment,
      subtotal: view.subtotal,
      tax: view.tax,
      total: view.total,
      imported_at: '',
      updated_at: '',
    },
    sections,
    lines: view.lines.map((line, index) => ({
      id: `${view.revision_id}-line-${index}`,
      template_id: view.revision_id,
      section_code: line.section_code,
      group_label: line.group_label,
      name: line.name,
      quantity: line.quantity == null ? null : Number(line.quantity),
      unit: line.unit,
      unit_price: line.is_por ? null : line.unit_price,
      amount: line.is_por ? 0 : (line.amount ?? 0),
      remark: line.is_por ? '価格未確定（別途お見積り）' : null,
      sort_order: index,
    })),
    base_breakdown_items: view.base_lines.map((line, index) => ({
      id: `${view.revision_id}-base-${index}`,
      base_model_id: modelId,
      spec_code: view.spec_code,
      section: line.section,
      name: line.name,
      quantity: Number(line.quantity),
      unit: line.unit,
      unit_price: line.unit_price,
      amount: line.amount,
      remark: null,
      sort_order: index,
    })),
    baseline_option_ids: view.baseline.map((item) => item.option_id),
  };
}

/** 売価だけの標準見積と、お客様の選択から価格を計算する（DB の見積依頼と同じ式） */
export function computeSaleViewPricing(
  bundle: CatalogBundle,
  view: StandardEstimateSaleView,
  selectedOptionIds: string[],
  variantChoiceIds: string[],
  exteriorFaces: ExteriorFaceSelection[]
): StandardEstimatePricingResult {
  const model = bundle.model;
  const taxRate = Number(view.tax_rate);
  const current = computePricing(
    model,
    bundle.options,
    bundle.categories,
    selectedOptionIds.map((option_id) => ({ option_id, variant_choice_ids: variantChoiceIds })),
    taxRate,
    { groups: bundle.variantGroups, choices: bundle.variantChoices },
    0,
    exteriorFaces
  );
  // 防火の標準見積を使うときは、防火仕様の行（別途見積）は標準見積に含まれるので数えない
  const fireCategoryIds = new Set(bundle.categories.filter((category) => category.code === 'fireproof').map((category) => category.id));
  const optionById = new Map(bundle.options.map((option) => [option.id, option]));
  const currentLines = current.lines.filter(
    (line) => !(view.fire_spec_code === 'fire' && fireCategoryIds.has(optionById.get(line.option_id)?.category_id ?? ''))
  );
  const currentTotal = (section: LineSection) =>
    currentLines.filter((line) => sectionForLine(line) === section).reduce((sum, line) => sum + line.amount, 0);

  const sectionPricings: StandardEstimateSectionPricing[] = (['base', 'interior_exterior', 'option', 'sitework'] as const).map((code) => {
    const section = view.sections.find((row) => row.code === code);
    const lineSubtotal = section?.line_subtotal ?? 0;
    const expenseAmount = section?.expense_amount ?? 0;
    if (code === 'base') {
      return { code, label: SECTION_LABEL[code], line_subtotal: lineSubtotal, expense_amount: expenseAmount, total: lineSubtotal + expenseAmount, delta_line: 0, delta_expense: 0 };
    }
    const deltaLine = currentTotal(code) - baselineSectionTotal(view, code);
    const newLine = lineSubtotal + deltaLine;
    const newExpense =
      section?.expense_method === 'rate' ? truncMul(newLine, view.expense_rate) : section?.expense_method === 'fixed' ? expenseAmount : 0;
    return {
      code,
      label: SECTION_LABEL[code],
      line_subtotal: newLine,
      expense_amount: newExpense,
      total: newLine + newExpense,
      delta_line: deltaLine,
      delta_expense: newExpense - expenseAmount,
    };
  });

  const byCode = (code: EstimateSectionCode) => sectionPricings.find((section) => section.code === code)!;
  const subtotalRaw = sectionPricings.reduce((sum, section) => sum + section.total, 0);
  const subtotal = subtotalRaw + view.adjustment;
  const tax = truncMul(subtotal, taxRate);
  const freeSubtotal = currentLines.filter((line) => line.is_free_product).reduce((sum, line) => sum + line.amount, 0);
  const pricing: PricingResult = {
    base_model_id: model.id,
    base_price: byCode('base').line_subtotal,
    expense_rate: Number(view.expense_rate),
    base_expense: byCode('base').expense_amount,
    base_total: byCode('base').total,
    // 画像・別途見積の判定などのため、現在の商品選択を残す（金額の正本は区分の合計）
    lines: current.lines,
    option_subtotal: byCode('interior_exterior').line_subtotal + byCode('option').line_subtotal,
    option_expense: byCode('interior_exterior').expense_amount + byCode('option').expense_amount,
    option_total: byCode('interior_exterior').total + byCode('option').total,
    installation_subtotal: byCode('sitework').total,
    free_subtotal: freeSubtotal,
    subtotal_raw: subtotalRaw,
    adjustment: view.adjustment,
    subtotal,
    tax_rate: taxRate,
    tax,
    total: subtotal + tax,
    has_price_on_request: view.has_por || currentLines.some((line) => line.price_on_request),
  };

  return {
    pricing,
    sections: sectionPricings,
    template: saleViewToTemplateBundle(view, model.id),
    has_changes: sectionPricings.some((section) => section.delta_line !== 0 || section.delta_expense !== 0),
  };
}

/** 防火仕様（fire-proof）を選んでいるか */
export function isFireProofSelected(bundle: Pick<CatalogBundle, 'options'>, selectedOptionIds: string[]): boolean {
  return bundle.options.some((option) => option.code === FIRE_PROOF_OPTION_CODE && selectedOptionIds.includes(option.id));
}
