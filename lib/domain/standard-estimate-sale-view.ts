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
 *
 * v2.5 の標準見積（pricing_model = v2.5、get_simulator_v25_sale_views。v2.5 PR-C1）は、選んだ商品の価格に商品価格の列（原価）を使わず、
 * 売価の表（prices）で決める。DB の standard_estimate_v25_selection_unit・standard_estimate_v25_configuration_money と同じ決まり：
 *   版の選択枠と同じ「商品＋選択肢」は公開した版の売価、それ以外は組み合わせごとの売価の表（今の原価 Version × 版の率）。
 *   未確定（別途見積・別途工事・原価未設定）は 0 円として合計し、別途見積の印を付ける。標準状態の商品の合計は版の選択枠の金額
 */
import { computePricing } from './pricing';
import { defaultVariantIdsFor } from './preset';
import { truncMul, truncQuantity } from './standard-estimate-money';
import type { StandardEstimatePricingResult, StandardEstimateSectionPricing, V25MissingUnit } from './standard-estimate-pricing';
import { INTERIOR_EXTERIOR_CATEGORY_CODES } from './standard-estimate-pricing';
import type { ExteriorFaceSelection } from './exterior-wall';
import type { CatalogBundle, EstimateSectionCode, EstimateTemplateBundle, OptionVariantChoice, OptionVariantGroup, PricingResult, ProductOption } from './types';

type LineSection = Exclude<EstimateSectionCode, 'base'>;

export interface StandardEstimateSaleViewSection {
  code: EstimateSectionCode;
  expense_method: 'rate' | 'none' | 'fixed';
  line_subtotal: number;
  expense_amount: number;
  total: number;
  has_por: boolean;
}

/**
 * v2.5 の売価の表（商品 1 つ分）。groups は選択項目の順に、その項目の選択肢 ID を並べたもの。
 * units のキーは、選択項目の順に選んだ選択肢の位置（選ばないは -）を . でつないだもの。値は売価単価（null は価格未確定）。
 * 組み合わせが多い商品は partial：標準の組み合わせ（default_key）と、そこから 1 つの選択項目だけを変えた組み合わせだけが入る。
 * それ以外の組み合わせはサーバー（get_simulator_v25_units）で計算する
 */
export type V25PriceTable =
  | { por: true }
  | { groups: string[][]; units: Record<string, number | null>; partial?: boolean; default_key?: string };

/** サーバーで計算した、表に無い「商品＋選択肢」の売価単価（キーは v25UnitKey。null は価格未確定） */
export type V25UnitLookup = ReadonlyMap<string, number | null>;

/** 表に無い「商品＋選択肢」の売価のキー（版ごとに違うので版を含める） */
export function v25UnitKey(revisionId: string, optionId: string, choiceIds: string[]): string {
  return `${revisionId}|${optionId}|${[...new Set(choiceIds)].sort().join(',')}`;
}

const hasUnit = (units: Record<string, number | null>, key: string) => Object.prototype.hasOwnProperty.call(units, key);

export interface StandardEstimateSaleView {
  /** v2.5 の標準見積（v2.5 PR-C1）。無ければ v2.5 以前の形 */
  pricing_model?: 'v2.5';
  /** v2.5：商品ごとの選択肢の組み合わせの売価の表（シミュレーターに渡すときだけ） */
  prices?: Record<string, V25PriceTable> | null;
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
    /** v2.5：版の選択枠の金額（未確定は null） */
    amount?: number | null;
  }>;
}

/** v2.5 の標準見積か（v2.5 PR-C1） */
export function isV25SaleView(view: StandardEstimateSaleView | null | undefined): boolean {
  return view?.pricing_model === 'v2.5';
}

/** 選んだ選択肢から、売価の表のキーを作る。表に無い選択肢・同じ項目の 2 つ選びは null（価格未確定） */
export function v25PriceKey(table: { groups: string[][] }, choiceIds: string[]): string | null {
  const chosen = new Set(choiceIds);
  const parts: string[] = [];
  let used = 0;
  for (const group of table.groups) {
    const picked = group.filter((id) => chosen.has(id));
    if (picked.length > 1) return null;
    parts.push(picked.length === 0 ? '-' : String(group.indexOf(picked[0])));
    used += picked.length;
  }
  if (used !== chosen.size) return null;
  return parts.join('.');
}

/**
 * v2.5 の「商品＋選択肢」の売価単価（DB の standard_estimate_v25_selection_unit と同じ決まり）。null は価格未確定。
 * 版の選択枠と同じ「商品＋選択肢」は公開した版の売価、それ以外は売価の表。
 * undefined は、組み合わせが多い商品（partial）で表に無く、まだサーバーで計算していない組み合わせ
 */
export function v25SelectionUnit(
  view: StandardEstimateSaleView,
  optionId: string,
  choiceIds: string[],
  lookup?: V25UnitLookup
): number | null | undefined {
  const chosen = new Set(choiceIds);
  const slot = view.baseline.find(
    (item) => item.option_id === optionId && item.variant_choice_ids.length === chosen.size && item.variant_choice_ids.every((id) => chosen.has(id))
  );
  if (slot) return slot.price_on_request ? null : slot.unit_price;
  const table = view.prices?.[optionId];
  if (!table || 'por' in table) return null;
  const key = v25PriceKey(table, [...chosen]);
  if (key === null) return null;
  if (hasUnit(table.units, key)) return table.units[key];
  if (!table.partial) return null;
  return lookup?.get(v25UnitKey(view.revision_id, optionId, [...chosen]));
}

/**
 * 組み合わせが多い商品（partial）の、表に無い組み合わせの売価の目安：標準の売価に、1 か所ずつ変えたときの差を足す。
 * v2.5 の式は差額を足してから率を掛けるので数円ずれうる（正確な売価はサーバーで計算して置き換える）。null は目安も出せない
 */
function v25ApproxUnit(view: StandardEstimateSaleView, optionId: string, choiceIds: string[]): number | null {
  const table = view.prices?.[optionId];
  if (!table || 'por' in table || !table.partial || table.default_key === undefined) return null;
  const key = v25PriceKey(table, choiceIds);
  const base = table.units[table.default_key];
  if (key === null || base === null || base === undefined) return null;
  const baseParts = table.default_key.split('.');
  const parts = key.split('.');
  let sum = base;
  for (let index = 0; index < parts.length; index++) {
    if (parts[index] === baseParts[index]) continue;
    const swap = [...baseParts.slice(0, index), parts[index], ...baseParts.slice(index + 1)].join('.');
    const unit = table.units[swap];
    if (unit === null || unit === undefined) return null;
    sum += unit - base;
  }
  return sum;
}

/**
 * v2.5 の標準見積の版の選択枠の商品。シミュレーターの仕様・防火条件の標準構成にする（2026-10-29 先方回答。
 * 下書きは使わず、公開中の版だけ）。版が無い・v2.5 でなければ null（旧来の標準構成）
 */
export function v25SlotOptionIds(view: StandardEstimateSaleView | null): string[] | null {
  if (!view || !isV25SaleView(view)) return null;
  return [...new Set(view.baseline.map((item) => item.option_id))];
}

/**
 * v2.5 の標準見積での「標準の選択肢」：版の選択枠に同じ商品があれば、その選択枠の選択肢（標準のままなら差額 0）。
 * 無ければ商品の標準の選択肢（defaultVariantIdsFor）。view が v2.5 でなければ商品の標準の選択肢だけ
 */
export function v25StandardVariantIds(
  groups: OptionVariantGroup[],
  choices: OptionVariantChoice[],
  view: StandardEstimateSaleView | null,
  optionIds: string[]
): string[] {
  const defaults = defaultVariantIdsFor(groups, choices, optionIds);
  if (!view || !isV25SaleView(view)) return defaults;
  const selected = new Set(optionIds);
  const slotChoices = new Map<string, string[]>();
  for (const item of view.baseline) {
    if (selected.has(item.option_id) && !slotChoices.has(item.option_id)) slotChoices.set(item.option_id, item.variant_choice_ids);
  }
  if (slotChoices.size === 0) return defaults;
  const optionOfGroup = new Map(groups.map((group) => [group.id, group.option_id]));
  const optionOfChoice = new Map(choices.map((choice) => [choice.id, optionOfGroup.get(choice.group_id)]));
  return [
    ...defaults.filter((id) => !slotChoices.has(optionOfChoice.get(id) ?? '')),
    // 選択枠の選択肢のうち、今のカタログにある（公開中の）ものだけ
    ...[...slotChoices.entries()].flatMap(([optionId, ids]) => ids.filter((id) => optionOfChoice.get(id) === optionId)),
  ];
}

/**
 * v2.5 の売価を使う間に、仕様の v2.5 の標準見積が無いときの金額（価格は準備中）。原価から金額を出さず、すべて 0 円・別途見積にする
 * （DB の保存・見積依頼も同じく金額を未確定にする：apply_standard_estimate_to_configuration）
 */
export function pendingSaleViewPricing(pricing: PricingResult): PricingResult {
  return {
    ...pricing,
    base_price: 0,
    base_expense: 0,
    base_total: 0,
    lines: pricing.lines.map((line) => ({ ...line, unit_price: 0, amount: 0, price_on_request: true, variants: line.variants.map((variant) => ({ ...variant, extra_price: 0 })) })),
    option_subtotal: 0,
    option_expense: 0,
    option_total: 0,
    installation_subtotal: 0,
    free_subtotal: 0,
    subtotal_raw: 0,
    adjustment: 0,
    subtotal: 0,
    tax: 0,
    total: 0,
    has_price_on_request: true,
  };
}

/**
 * v2.5 の売価を使うとき、お客様の画面に渡すカタログから旧来の金額を外す（表示用の売価は v25DisplayCatalog で作る）。
 * 商品価格・追加金額の列は原価。本体の価格・本体内訳は旧来のサイト価格で、v2.5 では原価として率を掛ける元の数字のため、これも渡さない
 */
export function withoutCatalogCosts(bundle: CatalogBundle): CatalogBundle {
  return {
    ...bundle,
    model: { ...bundle.model, base_price: 0 },
    options: bundle.options.map((option) => ({ ...option, price: 0 })),
    variantChoices: bundle.variantChoices.map((choice) => ({ ...choice, extra_price: 0 })),
    baseBreakdowns: (bundle.baseBreakdowns ?? []).map((item) => ({ ...item, unit_price: 0, amount: 0 })),
  };
}

/**
 * v2.5 の売価を使うとき、お客様の画面に渡す旧テンプレート（Excel の標準見積）から金額を外す。
 * 仕様の選択肢・標準構成（spec_code・名前・標準選択の商品）だけを使い、金額は使わない
 */
export function withoutTemplatePrices(templates: EstimateTemplateBundle[]): EstimateTemplateBundle[] {
  return templates.map((row) => ({
    ...row,
    template: { ...row.template, subtotal_raw: 0, adjustment: 0, subtotal: 0, tax: 0, total: 0 },
    sections: row.sections.map((section) => ({ ...section, line_subtotal: 0, expense_amount: 0, total: 0 })),
    lines: row.lines.map((line) => ({ ...line, unit_price: null, amount: 0 })),
    base_breakdown_items: row.base_breakdown_items.map((item) => ({ ...item, unit_price: 0, amount: 0 })),
  }));
}

/**
 * 画面に出す商品価格・選択肢の差額を、v2.5 の売価から作る（原価は使わない）。
 * 商品価格：標準の選択肢での売価単価。選択肢の差額：同じ選択項目の標準の選択肢と入れ替えたときの売価単価の差（目安）。
 * 合計はこの値ではなく v25SelectionUnit で計算する（v2.5 の式は差額を足してから率を掛けるため、選択項目が 2 つ以上ある商品は数円ずれうる）。
 * view が無い（この仕様の v2.5 の標準見積が無い）ときは、すべて価格未確定にする
 */
export function v25DisplayCatalog(
  options: ProductOption[],
  groups: OptionVariantGroup[],
  choices: OptionVariantChoice[],
  view: StandardEstimateSaleView | null,
  lookup?: V25UnitLookup
): { options: ProductOption[]; choices: OptionVariantChoice[] } {
  if (!view) {
    return {
      options: options.map((option) => ({ ...option, price: 0, price_on_request: true })),
      choices: choices.map((choice) => ({ ...choice, extra_price: 0, price_on_request: true })),
    };
  }
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupOfChoice = new Map(choices.map((choice) => [choice.id, choice.group_id]));
  const defaultsOf = new Map<string, string[]>();
  const defaults = (optionId: string) => {
    let ids = defaultsOf.get(optionId);
    if (!ids) {
      ids = defaultVariantIdsFor(groups, choices, [optionId]);
      defaultsOf.set(optionId, ids);
    }
    return ids;
  };
  // 売価の目安：表（またはサーバーで計算した値）に無ければ、標準と 1 か所だけ変えた売価から作る
  const unitOf = (optionId: string, ids: string[]) => {
    const unit = v25SelectionUnit(view, optionId, ids, lookup);
    return unit === undefined ? v25ApproxUnit(view, optionId, ids) : unit;
  };
  const displayOptions = options.map((option) => {
    const unit = unitOf(option.id, defaults(option.id));
    return { ...option, price: unit ?? 0, price_on_request: unit === null };
  });
  const displayChoices = choices.map((choice) => {
    const group = groupById.get(choice.group_id);
    if (!group) return { ...choice, extra_price: 0, price_on_request: true };
    const base = defaults(group.option_id);
    const baseUnit = unitOf(group.option_id, base);
    const swapped = [...base.filter((id) => groupOfChoice.get(id) !== group.id), choice.id];
    const unit = unitOf(group.option_id, swapped);
    if (unit === null) return { ...choice, extra_price: 0, price_on_request: true };
    return { ...choice, extra_price: baseUnit === null ? 0 : unit - baseUnit, price_on_request: false };
  });
  return { options: displayOptions, choices: displayChoices };
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
 * v2.5 の版は選択枠が無くても使う（DB の standard_estimate_v25_revision_for_configuration と同じ）
 */
export function pickSaleView(
  views: StandardEstimateSaleView[],
  modelSlug: string,
  specCode: string,
  fireSelected: boolean
): StandardEstimateSaleView | null {
  const spec = saleViewSpecCode(modelSlug, specCode);
  const usable = views.filter((view) => view.spec_code === spec && (isV25SaleView(view) || view.baseline.length > 0));
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

/**
 * 売価だけの標準見積と、お客様の選択から価格を計算する（DB の見積依頼と同じ式）。
 * v2.5：lookup はサーバーで計算した表に無い組み合わせの売価。まだ無い組み合わせは目安で計算し、missing_units に挙げる
 */
export function computeSaleViewPricing(
  bundle: CatalogBundle,
  view: StandardEstimateSaleView,
  selectedOptionIds: string[],
  variantChoiceIds: string[],
  exteriorFaces: ExteriorFaceSelection[],
  lookup?: V25UnitLookup
): StandardEstimatePricingResult {
  const model = bundle.model;
  const taxRate = Number(view.tax_rate);
  const v25 = isV25SaleView(view);
  const missing = new Map<string, V25MissingUnit>();
  const unitOf = (optionId: string, choiceIds: string[]) => {
    const unit = v25SelectionUnit(view, optionId, choiceIds, lookup);
    if (unit !== undefined) return unit;
    missing.set(v25UnitKey(view.revision_id, optionId, choiceIds), { revision_id: view.revision_id, option_id: optionId, choice_ids: choiceIds });
    return v25ApproxUnit(view, optionId, choiceIds);
  };
  const current = computePricing(
    model,
    bundle.options,
    bundle.categories,
    selectedOptionIds.map((option_id) => ({ option_id, variant_choice_ids: variantChoiceIds })),
    taxRate,
    { groups: bundle.variantGroups, choices: bundle.variantChoices },
    0,
    exteriorFaces,
    // v2.5：商品価格の列（原価）を使わず、売価の表で決める
    v25 ? (option, picked) => unitOf(option.id, picked.map((choice) => choice.id)) : undefined
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
    // v2.5：標準状態の商品の合計は版の選択枠の金額（未確定は含めない）
    const baselineTotal = v25
      ? view.baseline.filter((item) => item.section_code === code).reduce((sum, item) => sum + (item.amount ?? 0), 0)
      : baselineSectionTotal(view, code);
    const deltaLine = currentTotal(code) - baselineTotal;
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
    ...(v25 ? { missing_units: [...missing.values()] } : {}),
  };
}

/** 防火仕様（fire-proof）を選んでいるか */
export function isFireProofSelected(bundle: Pick<CatalogBundle, 'options'>, selectedOptionIds: string[]): boolean {
  return bundle.options.some((option) => option.code === FIRE_PROOF_OPTION_CODE && selectedOptionIds.includes(option.id));
}

/**
 * 保存した仕様の画面に出す金額を、v2.5 の売価で計算する（v2.5 PR-C1。見積依頼の確認画面・本部の保存プランの画面）。
 * 使う版はシミュレーターと同じく機種・用途・防火で決める。v2.5 の版が無い仕様は価格準備中（0 円・別途見積）。
 * 商品価格の列（原価）は金額に使わない。金額の正本は DB（保存・見積依頼で計算し直す）
 */
export function v25ConfigurationPricing(
  bundle: CatalogBundle,
  views: StandardEstimateSaleView[],
  input: { specCode: string | null; optionIds: string[]; variantChoiceIds: string[]; exteriorFaces: ExteriorFaceSelection[] },
  lookup?: V25UnitLookup
): { pricing: PricingResult; missing: V25MissingUnit[] } {
  const view = input.specCode
    ? pickSaleView(views, bundle.model.slug, input.specCode, isFireProofSelected(bundle, input.optionIds))
    : null;
  if (view && isV25SaleView(view)) {
    const result = computeSaleViewPricing(bundle, view, input.optionIds, input.variantChoiceIds, input.exteriorFaces, lookup);
    return { pricing: result.pricing, missing: result.missing_units ?? [] };
  }
  const pending = pendingSaleViewPricing(
    computePricing(
      bundle.model,
      bundle.options,
      bundle.categories,
      input.optionIds.map((option_id) => ({ option_id, variant_choice_ids: input.variantChoiceIds })),
      undefined,
      { groups: bundle.variantGroups, choices: bundle.variantChoices },
      null,
      input.exteriorFaces
    )
  );
  return { pricing: pending, missing: [] };
}
