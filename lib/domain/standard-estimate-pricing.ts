import { computePricing, DEFAULT_EXPENSE_RATE, ROUNDING_UNIT, type SelectionInput } from './pricing';
import { defaultVariantIdsFor } from './preset';
import { estimateBaselineOptionCodes } from './estimate-template';
import {
  EXTERIOR_FACES,
  defaultVariantIdsForExteriorOption,
  makeDefaultExteriorFaces,
  type ExteriorFaceSelection,
} from './exterior-wall';
import type {
  CatalogBundle,
  EstimateSectionCode,
  EstimateTemplateBaselineItem,
  EstimateTemplateBundle,
  FinishLevel,
  PricingResult,
  ProductOption,
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

type StandardSelectionInput = string | SelectionInput;
type BaselineItem = Pick<
  EstimateTemplateBaselineItem,
  'option_id' | 'category_id' | 'quantity' | 'slot_key' | 'section_code' | 'sort_order'
>;

export function defaultEstimateSectionForOption(
  bundle: Pick<CatalogBundle, 'categories'>,
  option: ProductOption
): EstimateSectionCode {
  const category = bundle.categories.find((row) => row.id === option.category_id);
  if (option.is_installation || category?.code === 'free-product') return 'sitework';
  return category && INTERIOR_EXTERIOR_CATEGORY_CODES.has(category.code)
    ? 'interior_exterior'
    : 'option';
}

function compatibilityBaselineItems(
  bundle: CatalogBundle,
  template: EstimateTemplateBundle
): BaselineItem[] {
  const savedBaselineIds = template.baseline_option_ids.filter((id) =>
    bundle.options.some((option) => option.id === id)
  );
  const fallbackBaselineCodes = savedBaselineIds.length === 0
    ? estimateBaselineOptionCodes(bundle.model, template.template.spec_code)
    : [];
  const optionByCode = new Map(bundle.options.map((option) => [option.code, option.id]));
  const optionIds = savedBaselineIds.length > 0
    ? savedBaselineIds
    : fallbackBaselineCodes.map((code) => optionByCode.get(code)).filter((id): id is string => Boolean(id));

  let sortOrder = 0;
  return optionIds.flatMap((optionId) => {
    const option = bundle.options.find((row) => row.id === optionId);
    if (!option) return [];
    const category = bundle.categories.find((row) => row.id === option.category_id);
    const sectionCode = defaultEstimateSectionForOption(bundle, option);
    if (category?.code === 'exterior-wall') {
      return ['front', 'right', 'rear', 'left'].map((slotKey) => ({
        option_id: option.id,
        category_id: option.category_id,
        quantity: 1,
        slot_key: slotKey,
        section_code: sectionCode,
        sort_order: ++sortOrder,
      }));
    }
    return [{
      option_id: option.id,
      category_id: option.category_id,
      quantity: 1,
      slot_key: `${category?.code ?? 'legacy'}:${sortOrder + 1}`,
      section_code: sectionCode,
      sort_order: ++sortOrder,
    }];
  });
}

function normalizedBaselineItems(bundle: CatalogBundle, template: EstimateTemplateBundle): BaselineItem[] {
  const stored = template.baseline_items.filter((item) =>
    bundle.options.some((option) => option.id === item.option_id && option.category_id === item.category_id)
  );
  return stored.length > 0 ? stored : compatibilityBaselineItems(bundle, template);
}

function addAmount(
  totals: Map<EstimateSectionCode, number>,
  sectionCode: EstimateSectionCode,
  amount: number
): void {
  totals.set(sectionCode, (totals.get(sectionCode) ?? 0) + amount);
}

function optionUnitPrice(
  bundle: CatalogBundle,
  option: ProductOption,
  variantChoiceIds: string[]
): number {
  const groupIds = new Set(
    bundle.variantGroups.filter((group) => group.option_id === option.id).map((group) => group.id)
  );
  const variantExtra = bundle.variantChoices
    .filter((choice) => variantChoiceIds.includes(choice.id) && groupIds.has(choice.group_id))
    .reduce((sum, choice) => sum + (choice.price_on_request ? 0 : choice.extra_price), 0);
  return (option.price_on_request ? 0 : option.price) + variantExtra;
}

export function exteriorFacesForEstimateBaseline(
  bundle: CatalogBundle,
  template: EstimateTemplateBundle,
  selectedVariantIds: string[] = []
): ExteriorFaceSelection[] {
  const baselineItems = normalizedBaselineItems(bundle, template);
  const exteriorCategory = bundle.categories.find((category) => category.code === 'exterior-wall');
  const exteriorOptions = bundle.options
    .filter((option) => option.category_id === exteriorCategory?.id && option.status === 'published')
    .sort((a, b) => a.sort_order - b.sort_order);
  const slotByFace = new Map(
    baselineItems
      .filter((item) => item.category_id === exteriorCategory?.id)
      .map((item) => [item.slot_key === 'rear' ? 'back' : item.slot_key, item])
  );
  if (EXTERIOR_FACES.every((face) => slotByFace.has(face.code))) {
    return EXTERIOR_FACES.map((face) => {
      const item = slotByFace.get(face.code)!;
      return {
        face_code: face.code,
        option_id: item.option_id,
        variant_choice_ids: defaultVariantIdsForExteriorOption(
          item.option_id,
          bundle.variantGroups,
          bundle.variantChoices,
          selectedVariantIds
        ),
      };
    });
  }
  const ids = [...new Set(baselineItems.map((item) => item.option_id))];
  return makeDefaultExteriorFaces(
    exteriorOptions,
    bundle.variantGroups,
    bundle.variantChoices,
    ids,
    selectedVariantIds
  );
}

function expenseFor(amount: number, rate: number): number {
  return Math.floor(amount * rate);
}

/**
 * Excel標準見積を価格の正本とし、baselineの商品構成と現在選択の価格差だけを反映する。
 */
export function computeStandardEstimatePricing(
  bundle: CatalogBundle,
  template: EstimateTemplateBundle,
  selectedOptions: StandardSelectionInput[],
  variantChoiceIds: string[],
  exteriorFaces: ExteriorFaceSelection[],
  finishLevel: FinishLevel
): StandardEstimatePricingResult {
  const model = bundle.model;
  const baselineItems = normalizedBaselineItems(bundle, template);
  const baselineByCategory = new Map<string, BaselineItem[]>();
  for (const item of baselineItems) {
    const rows = baselineByCategory.get(item.category_id) ?? [];
    rows.push(item);
    baselineByCategory.set(item.category_id, rows);
  }

  const normalizedSelections = selectedOptions.map((selection) =>
    typeof selection === 'string' ? { option_id: selection } : selection
  );
  const selectedCountByCategory = new Map<string, number>();
  for (const selection of normalizedSelections) {
    const option = bundle.options.find((row) => row.id === selection.option_id);
    if (option) selectedCountByCategory.set(option.category_id, (selectedCountByCategory.get(option.category_id) ?? 0) + 1);
  }
  const currentSelections = normalizedSelections.map((selection) => {
    if (selection.quantity !== undefined) return selection;
    const option = bundle.options.find((row) => row.id === selection.option_id);
    if (!option) return selection;
    const categoryBaseline = baselineByCategory.get(option.category_id) ?? [];
    const sameOptionQuantity = categoryBaseline
      .filter((item) => item.option_id === option.id)
      .reduce((sum, item) => sum + item.quantity, 0);
    if (sameOptionQuantity > 0) return { ...selection, quantity: sameOptionQuantity };
    const category = bundle.categories.find((row) => row.id === option.category_id);
    if (category?.selection_mode === 'single' && selectedCountByCategory.get(option.category_id) === 1) {
      const baselineQuantity = categoryBaseline.reduce((sum, item) => sum + item.quantity, 0);
      if (baselineQuantity > 0) return { ...selection, quantity: baselineQuantity };
    }
    return { ...selection, quantity: 1 };
  });

  const effectiveExteriorFaces = exteriorFaces.length > 0
    ? exteriorFaces
    : exteriorFacesForEstimateBaseline(bundle, template, variantChoiceIds);
  const current = computePricing(
    model,
    bundle.options,
    bundle.categories,
    currentSelections.map((selection) => ({ ...selection, variant_choice_ids: variantChoiceIds })),
    template.template.tax_rate,
    { groups: bundle.variantGroups, choices: bundle.variantChoices },
    0,
    effectiveExteriorFaces
  );

  const baselineVariantIds = defaultVariantIdsFor(
    bundle.variantGroups,
    bundle.variantChoices,
    [...new Set(baselineItems.map((item) => item.option_id))]
  );
  const baselineTotals = new Map<EstimateSectionCode, number>();
  for (const item of baselineItems) {
    const option = bundle.options.find((row) => row.id === item.option_id);
    if (!option) continue;
    addAmount(baselineTotals, item.section_code, optionUnitPrice(bundle, option, baselineVariantIds) * item.quantity);
  }

  const currentTotals = new Map<EstimateSectionCode, number>();
  for (const line of current.lines) {
    const option = bundle.options.find((row) => row.id === line.option_id);
    if (!option) continue;
    const categoryBaseline = baselineByCategory.get(option.category_id) ?? [];
    const faceMatch = line.code.match(/__face_(front|right|back|left)$/);
    const slotKey = faceMatch?.[1] === 'back' ? 'rear' : faceMatch?.[1];
    const slotBaseline = slotKey
      ? categoryBaseline.find((item) => item.slot_key === slotKey)
      : null;
    const exactBaseline = categoryBaseline.find((item) => item.option_id === option.id);
    const sections = [...new Set(categoryBaseline.map((item) => item.section_code))];
    const sectionCode = slotBaseline?.section_code
      ?? exactBaseline?.section_code
      ?? (sections.length === 1 ? sections[0] : defaultEstimateSectionForOption(bundle, option));
    addAmount(currentTotals, sectionCode, line.amount);
  }

  const sectionPricings: StandardEstimateSectionPricing[] = template.sections.map((section) => {
    const currentMaster = currentTotals.get(section.code) ?? 0;
    const baselineMaster = baselineTotals.get(section.code) ?? 0;
    const deltaLine = currentMaster - baselineMaster;
    const rate = section.expense_rate ?? model.expense_rate ?? DEFAULT_EXPENSE_RATE;
    const deltaExpense = section.code === 'sitework'
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

  void finishLevel;
  return { pricing, sections: sectionPricings, template, has_changes: hasChanges };
}
