import type { BaseModel, CatalogBundle, OptionCategory, ProductOption, SpecMatrix } from './types';

/** 公開カタログ内だけで使う「このカテゴリーでは選べる仕様なし」の非永続sentinel。 */
export const CUSTOMER_SPEC_DENY_ALL = '__customer_category_not_selectable__';

/**
 * 本体分類表の選択 / ×（お客様の選択に使う形）。正本は DB の本体仕様マトリクス（PR A）で、
 * buildCustomerCategoryMatrix() で組み立てる。SQL の customer_category_selectable() と同じ判定。
 *
 * - itemByCategoryCode: Category → Matrix Item の対応。対応の無いカテゴリー（防火・断熱・別途工事・自由商品など）は制限しない
 * - rows: 機種 slug → 仕様 → 選択できる項目。行が無い仕様では対象カテゴリーを選べない（fail closed）
 */
export interface CustomerCategoryMatrix {
  itemByCategoryCode: Readonly<Record<string, string>>;
  rows: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

/** 互換（#389 から移植。マトリクスの行ではない）：本体のみ（base）で選べる項目 */
const BASE_COMPAT_ITEMS = ['roof-exterior', 'entrance-door', 'sash'] as const;

/**
 * DB のマトリクスから、お客様の選択に使う可否表を作る。
 * マトリクスの表が無い DB（migration 未適用）では null（DB 側にも制限が無いため、画面も従来どおり制限しない）。
 *
 * - 有効な行・仕様・サイズ・項目だけを使う。セルが無い項目は選べない
 * - Configuration はサイズを持たないため、機種 × 仕様の有効な行がちょうど 1 つのときだけ使う（複数なら選べない）
 * - 互換：本体のみ（base）は屋根・外壁／玄関ドア／サッシ、BOX の hotel-single は BOX ホテル仕様の行
 */
export function buildCustomerCategoryMatrix(
  matrix: SpecMatrix | null,
  categories: Pick<OptionCategory, 'id' | 'code'>[],
  models: Pick<BaseModel, 'id' | 'slug'>[]
): CustomerCategoryMatrix | null {
  if (!matrix) return null;
  const activeItems = new Set(matrix.items.filter((item) => item.status === 'active').map((item) => item.code));
  const activeSpecs = new Set(matrix.specs.filter((spec) => spec.status === 'active').map((spec) => spec.code));
  const activeSizes = new Set(matrix.sizes.filter((size) => size.status === 'active').map((size) => size.code));
  const categoryCodeById = new Map(categories.map((category) => [category.id, category.code]));
  const itemByCategoryCode: Record<string, string> = {};
  for (const mapping of matrix.categoryItems) {
    const code = categoryCodeById.get(mapping.category_id);
    if (code) itemByCategoryCode[code] = mapping.matrix_item_code;
  }

  const rows: Record<string, Record<string, string[]>> = {};
  for (const model of models) {
    const modelRows = matrix.rows.filter(
      (row) => row.base_model_id === model.id && row.status === 'active' && activeSpecs.has(row.spec_code) && activeSizes.has(row.size_code)
    );
    const bySpec: Record<string, string[]> = {};
    for (const specCode of new Set(modelRows.map((row) => row.spec_code))) {
      const candidates = modelRows.filter((row) => row.spec_code === specCode);
      bySpec[specCode] =
        candidates.length === 1
          ? matrix.cells
              .filter((cell) => cell.matrix_row_id === candidates[0].id && cell.selectable && activeItems.has(cell.matrix_item_code))
              .map((cell) => cell.matrix_item_code)
          : [];
    }
    bySpec.base = BASE_COMPAT_ITEMS.filter((item) => activeItems.has(item));
    if (model.slug === 'box' && bySpec.hotel) bySpec['hotel-single'] = [...bySpec.hotel];
    rows[model.slug] = bySpec;
  }
  return { itemByCategoryCode, rows };
}

export function customerBusinessItemForCategory(
  matrix: CustomerCategoryMatrix | null | undefined,
  categoryCode: string
): string | null {
  return matrix?.itemByCategoryCode[categoryCode] ?? null;
}

/**
 * 本体分類表で制御するカテゴリーなら、機種 × 仕様の行に「選択」がある場合だけ true。
 * 制御対象外のカテゴリー・仕様が未設定・可否表が無い（migration 未適用）場合は従来どおり制限しない。
 * 行が無い機種・仕様は、確定表に無いカテゴリーを勝手に公開しないため fail closed。
 */
export function customerCategorySelectable(
  matrix: CustomerCategoryMatrix | null | undefined,
  modelSlug: string,
  specCode: string,
  categoryCode: string
): boolean {
  const item = customerBusinessItemForCategory(matrix, categoryCode);
  if (!matrix || !item || !specCode) return true;
  return Boolean(matrix.rows[modelSlug]?.[specCode]?.includes(item));
}

/**
 * legacy BOX `hotel-single` は、商品適合上 `residence` と同一互換範囲として扱う。
 * これは商品technical aliasだけであり、業務カテゴリー可否はBOXホテル仕様の行を使う。
 * それ以外のモデルでは文字列一致だけを使い、aliasを横展開しない。
 */
export function compatibleProductSpecCodes(
  modelSlug: string,
  specCode: string
): readonly string[] {
  return modelSlug === 'box' && specCode === 'hotel-single'
    ? ['hotel-single', 'residence']
    : [specCode];
}

export function productSpecCodesAllow(
  productSpecCodes: readonly string[],
  requestedSpecCode: string,
  modelSlug: string
): boolean {
  return (
    productSpecCodes.length === 0 ||
    compatibleProductSpecCodes(modelSlug, requestedSpecCode).some((code) =>
      productSpecCodes.includes(code)
    )
  );
}

/**
 * DBの商品spec_codesを個別商品適合の正本として残したまま、
 * 公開カタログ上だけ本体分類表のカテゴリー可否を交差させる。
 *
 * - DB spec_codes=[]: 商品側は全仕様共通 → カテゴリーが「選択」の仕様だけへ限定
 * - DB spec_codes!=[]: 商品側ホワイトリスト ∩ カテゴリー「選択」仕様
 * - BOX hotel-single: 商品適合のresidence technical aliasは維持するが、カテゴリー可否はhotel行を使う
 * - 交差結果0件: []は「全仕様共通」の意味なので、非永続sentinelでdeny-allを表す
 */
export function effectiveCustomerSpecCodes(
  matrix: CustomerCategoryMatrix | null | undefined,
  modelSlug: string,
  categoryCode: string,
  productSpecCodes: readonly string[]
): string[] {
  const businessItem = customerBusinessItemForCategory(matrix, categoryCode);
  if (!matrix || !businessItem) return [...productSpecCodes];

  const modelRows = matrix.rows[modelSlug];
  if (!modelRows) return [CUSTOMER_SPEC_DENY_ALL];

  const categorySpecs = Object.entries(modelRows)
    .filter(([, businessItems]) => businessItems.includes(businessItem))
    .map(([specCode]) => specCode);

  const effective = categorySpecs.filter((specCode) =>
    productSpecCodesAllow(productSpecCodes, specCode, modelSlug)
  );

  return effective.length > 0 ? effective : [CUSTOMER_SPEC_DENY_ALL];
}

/** 公開シミュレーター用CatalogBundleに、カテゴリー行列を非破壊で反映する（bundle.customerCategoryMatrix を使う）。 */
export function applyCustomerCategoryApplicability(bundle: CatalogBundle): CatalogBundle {
  const matrix = bundle.customerCategoryMatrix ?? null;
  if (!matrix) return bundle;
  const categoryById = new Map(bundle.categories.map((category) => [category.id, category.code]));
  const options: ProductOption[] = bundle.options.map((option) => {
    const categoryCode = categoryById.get(option.category_id);
    if (!categoryCode) return option;
    const spec_codes = effectiveCustomerSpecCodes(matrix, bundle.model.slug, categoryCode, option.spec_codes);
    if (
      spec_codes.length === option.spec_codes.length &&
      spec_codes.every((code, index) => code === option.spec_codes[index])
    ) {
      return option;
    }
    return { ...option, spec_codes };
  });
  return { ...bundle, options };
}
