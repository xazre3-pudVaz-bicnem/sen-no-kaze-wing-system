import { computePricing, DEFAULT_EXPENSE_RATE, ROUNDING_UNIT } from './pricing';
import { defaultVariantIdsFor } from './preset';
import { estimateBaselineOptionCodes } from './estimate-template';
import { makeDefaultExteriorFaces, type ExteriorFaceSelection } from './exterior-wall';
import type {
  CatalogBundle,
  EstimateSectionCode,
  EstimateTemplateBundle,
  FinishLevel,
  PricingResult,
} from './types';

export const INTERIOR_EXTERIOR_CATEGORY_CODES = new Set([
  'floor',
  'flooring',
  'wall-ceiling',
  'interior-door',
  'exterior-wall',
  'roof',
  'sash',
  'entrance-door',
  'service-door',
  'carpentry',
]);

export interface StandardEstimateSectionPricing {
  code: EstimateSectionCode;
  label: string;
  line_subtotal: number;
  expense_amount: number;
  total: number;
  delta_line: number;
  delta_expense: number;
}

export interface StandardEstimatePricingResult {
  pricing: PricingResult;
  sections: StandardEstimateSectionPricing[];
  template: EstimateTemplateBundle;
  /** 標準状態から商品マスター価格で生じた差額。0ならExcel原本の金額そのもの。 */
  has_changes: boolean;
}

function sectionCodeForLine(
  line: PricingResult['lines'][number]
): Exclude<EstimateSectionCode, 'base'> {
  if (line.is_installation || line.is_free_product) return 'sitework';
  return INTERIOR_EXTERIOR_CATEGORY_CODES.has(line.category_code) ? 'interior_exterior' : 'option';
}

function lineSubtotalBySection(
  lines: PricingResult['lines'],
  code: Exclude<EstimateSectionCode, 'base'>
): number {
  return lines
    .filter((line) => sectionCodeForLine(line) === code)
    .reduce((sum, line) => sum + line.amount, 0);
}

function expenseFor(amount: number, rate: number): number {
  return Math.floor(amount * rate);
}

/**
 * Excel標準見積を価格の正本とし、商品選択の変更分だけ商品マスター価格で差額反映する。
 * 標準状態ならtemplate.total等をそのまま返すため、Excel値を再計算で変えない。
 */
export function computeStandardEstimatePricing(
  bundle: CatalogBundle,
  template: EstimateTemplateBundle,
  selectedOptionIds: string[],
  variantChoiceIds: string[],
  exteriorFaces: ExteriorFaceSelection[],
  finishLevel: FinishLevel
): StandardEstimatePricingResult {
  const model = bundle.model;
  const current = computePricing(
    model,
    bundle.options,
    bundle.categories,
    selectedOptionIds.map((option_id) => ({ option_id, variant_choice_ids: variantChoiceIds })),
    template.template.tax_rate,
    { groups: bundle.variantGroups, choices: bundle.variantChoices },
    0,
    exteriorFaces
  );

  const savedBaselineIds = template.baseline_option_ids.filter((id) =>
    bundle.options.some((option) => option.id === id)
  );
  const fallbackBaselineCodes =
    savedBaselineIds.length === 0
      ? estimateBaselineOptionCodes(model, template.template.spec_code)
      : [];
  const optionByCode = new Map(bundle.options.map((option) => [option.code, option.id]));
  const baselineOptionIds =
    savedBaselineIds.length > 0
      ? savedBaselineIds
      : fallbackBaselineCodes.map((code) => optionByCode.get(code)).filter((id): id is string => Boolean(id));
  const baselineVariantIds = defaultVariantIdsFor(
    bundle.variantGroups,
    bundle.variantChoices,
    baselineOptionIds
  );
  const exteriorCategory = bundle.categories.find((category) => category.code === 'exterior-wall');
  const exteriorOptions = bundle.options
    .filter((option) => option.category_id === exteriorCategory?.id && option.status === 'published')
    .sort((a, b) => a.sort_order - b.sort_order);
  const baselineFaces = makeDefaultExteriorFaces(
    exteriorOptions,
    bundle.variantGroups,
    bundle.variantChoices,
    baselineOptionIds,
    baselineVariantIds
  );
  const baseline = computePricing(
    model,
    bundle.options,
    bundle.categories,
    baselineOptionIds.map((option_id) => ({ option_id, variant_choice_ids: baselineVariantIds })),
    template.template.tax_rate,
    { groups: bundle.variantGroups, choices: bundle.variantChoices },
    0,
    baselineFaces
  );

  const sectionPricings: StandardEstimateSectionPricing[] = template.sections.map((section) => {
    if (section.code === 'base') {
      return {
        code: section.code,
        label: section.label,
        line_subtotal: section.line_subtotal,
        expense_amount: section.expense_amount,
        total: section.total,
        delta_line: 0,
        delta_expense: 0,
      };
    }

    const currentMaster = lineSubtotalBySection(current.lines, section.code);
    const baselineMaster = lineSubtotalBySection(baseline.lines, section.code);
    const deltaLine = currentMaster - baselineMaster;
    const rate = section.expense_rate ?? model.expense_rate ?? DEFAULT_EXPENSE_RATE;
    const deltaExpense =
      section.code === 'sitework'
        ? 0
        : expenseFor(currentMaster, rate) - expenseFor(baselineMaster, rate);

    return {
      code: section.code,
      label: section.label,
      line_subtotal: section.line_subtotal + deltaLine,
      expense_amount: section.expense_amount + deltaExpense,
      total: section.total + deltaLine + deltaExpense,
      delta_line: deltaLine,
      delta_expense: deltaExpense,
    };
  });

  const base = sectionPricings.find((section) => section.code === 'base');
  const interior = sectionPricings.find((section) => section.code === 'interior_exterior');
  const option = sectionPricings.find((section) => section.code === 'option');
  const sitework = sectionPricings.find((section) => section.code === 'sitework');
  const hasChanges = sectionPricings.some(
    (section) => section.delta_line !== 0 || section.delta_expense !== 0
  );

  const subtotalRaw = sectionPricings.reduce((sum, section) => sum + section.total, 0);
  const subtotal = hasChanges
    ? Math.floor(subtotalRaw / ROUNDING_UNIT) * ROUNDING_UNIT
    : template.template.subtotal;
  const adjustment = hasChanges ? subtotal - subtotalRaw : template.template.adjustment;
  const tax = hasChanges
    ? Math.floor(subtotal * template.template.tax_rate)
    : template.template.tax;
  const total = hasChanges ? subtotal + tax : template.template.total;

  const pricing: PricingResult = {
    base_model_id: model.id,
    base_price: base?.line_subtotal ?? 0,
    expense_rate: model.expense_rate ?? DEFAULT_EXPENSE_RATE,
    base_expense: base?.expense_amount ?? 0,
    base_total: base?.total ?? 0,
    // 標準見積の明細はtemplate.linesが正本。ここには現在の商品選択を残し、
    // 既存UIの画像・別途見積判定などに利用する。
    lines: current.lines,
    option_subtotal: (interior?.line_subtotal ?? 0) + (option?.line_subtotal ?? 0),
    option_expense: (interior?.expense_amount ?? 0) + (option?.expense_amount ?? 0),
    option_total: (interior?.total ?? 0) + (option?.total ?? 0),
    installation_subtotal: sitework?.total ?? 0,
    free_subtotal: current.free_subtotal,
    subtotal_raw: subtotalRaw,
    adjustment,
    subtotal,
    tax_rate: template.template.tax_rate,
    tax,
    total,
    has_price_on_request: current.has_price_on_request,
  };

  // finishLevelは標準テンプレート選択時のUI状態と保存値に使う。
  // 価格はExcelテンプレートが正本なので、ここでは計算を枝分かれさせない。
  void finishLevel;

  return { pricing, sections: sectionPricings, template, has_changes: hasChanges };
}
