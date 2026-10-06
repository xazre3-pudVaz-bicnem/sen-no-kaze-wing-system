import type { CatalogBundle, ProductOption } from './types';

/** 公開カタログ内だけで使う「このカテゴリーでは選べる仕様なし」の非永続sentinel。 */
export const CUSTOMER_SPEC_DENY_ALL = '__customer_category_not_selectable__';

/**
 * 本体分類表 1シート目の業務項目。
 * DBカテゴリーはこの業務項目へ明示的に対応付け、本体分類表の選択 / ×は業務項目単位で判定する。
 */
export type CustomerBusinessItemCode =
  | 'roof-exterior'
  | 'interior'
  | 'entrance-door'
  | 'sash'
  | 'bath'
  | 'kitchen'
  | 'washbasin'
  | 'toilet'
  | 'entrance-storage'
  | 'interior-door'
  | 'closet'
  | 'bed'
  | 'furnishings'
  | 'other';

/**
 * 本体分類表と商品台帳カテゴリーの正式対応。
 *
 * - 屋根・外壁 → roof / exterior-wall
 * - 内装 → floor / wall-ceiling / carpentry
 * - サッシ色 → sash
 * - 勝手口ドア → service-door。分類表に専用列がないため、確定仕様としてサッシ列に従わせる。
 * - 備品 → furniture / appliances / office-supplies
 * - その他 → smartlock / exterior-parts
 *
 * lighting / aircon / boiler 等、分類表の列との対応が確定していないカテゴリーはここへ含めない。
 * 「その他」だからという理由だけで group_code 全体を自動採用しない。
 */
export const CUSTOMER_CATEGORY_BUSINESS_ITEM: Readonly<Record<string, CustomerBusinessItemCode>> = {
  roof: 'roof-exterior',
  'exterior-wall': 'roof-exterior',
  floor: 'interior',
  'wall-ceiling': 'interior',
  carpentry: 'interior',
  'entrance-door': 'entrance-door',
  sash: 'sash',
  'service-door': 'sash',
  ub: 'bath',
  kitchen: 'kitchen',
  washbasin: 'washbasin',
  toilet: 'toilet',
  'entrance-storage': 'entrance-storage',
  'interior-door': 'interior-door',
  closet: 'closet',
  bed: 'bed',
  furniture: 'furnishings',
  appliances: 'furnishings',
  'office-supplies': 'furnishings',
  smartlock: 'other',
  'exterior-parts': 'other',
};

export const CUSTOMER_MATRIX_CATEGORY_CODES = Object.freeze(
  Object.keys(CUSTOMER_CATEGORY_BUSINESS_ITEM)
);

const BASE_COMPAT = ['roof-exterior', 'entrance-door', 'sash'] as const;
const HOTEL = [
  'roof-exterior',
  'interior',
  'entrance-door',
  'sash',
  'bath',
  'washbasin',
  'toilet',
  'entrance-storage',
  'interior-door',
  'bed',
  'furnishings',
  'other',
] as const;
const RESIDENCE = [...HOTEL, 'kitchen'] as const;
const ROOM = [
  'roof-exterior',
  'interior',
  'interior-door',
  'closet',
  'bed',
  'furnishings',
  'other',
] as const;
const OFFICE = [
  'roof-exterior',
  'interior',
  'entrance-door',
  'sash',
  'bath',
  'kitchen',
  'toilet',
  'furnishings',
  'other',
] as const;
const BOX_WATER = [
  'roof-exterior',
  'interior',
  'entrance-door',
  'sash',
  'bath',
  'kitchen',
  'washbasin',
  'toilet',
] as const;
const STORAGE_OR_FLAT_OFFICE = ['roof-exterior', 'interior', 'entrance-door', 'sash'] as const;

/**
 * 本体分類表の「モデル × 仕様 × 項目 = 選択 / ×」。
 * `base` と BOX `hotel-single` は分類表そのものの行ではなく既存システム互換行。
 * - base: 本体のみUIの従来互換
 * - hotel-single: 既存BOX標準見積のlegacy identity。住居用相当として扱う
 */
export const CUSTOMER_CATEGORY_MATRIX: Readonly<
  Record<string, Readonly<Record<string, readonly CustomerBusinessItemCode[]>>>
> = {
  'wing-01': {
    base: BASE_COMPAT,
    hotel: HOTEL,
    residence: RESIDENCE,
    room: ROOM,
    office: OFFICE,
  },
  box: {
    base: BASE_COMPAT,
    hotel: HOTEL,
    residence: RESIDENCE,
    room: ROOM,
    office: OFFICE,
    'hotel-single': RESIDENCE,
    'water-kit': BOX_WATER,
    storage: STORAGE_OR_FLAT_OFFICE,
  },
  flat: {
    base: BASE_COMPAT,
    office: STORAGE_OR_FLAT_OFFICE,
  },
};

export function customerBusinessItemForCategory(
  categoryCode: string
): CustomerBusinessItemCode | null {
  return CUSTOMER_CATEGORY_BUSINESS_ITEM[categoryCode] ?? null;
}

/**
 * 本体分類表で制御するカテゴリーなら、model/spec行に「選択」がある場合だけtrue。
 * 制御対象外カテゴリーは既存挙動を維持する。
 * 未知のmodel/specは、確定表にないカテゴリーを勝手に公開しないためfail closed。
 */
export function customerCategorySelectable(
  modelSlug: string,
  specCode: string,
  categoryCode: string
): boolean {
  const businessItem = customerBusinessItemForCategory(categoryCode);
  if (!businessItem) return true;
  const row = CUSTOMER_CATEGORY_MATRIX[modelSlug]?.[specCode];
  return Boolean(row?.includes(businessItem));
}

/**
 * legacy BOX `hotel-single` は、商品適合上 `residence` と同一互換範囲として扱う。
 * `hotel-single` を明示登録した商品も将来互換のため受け入れる。
 */
export function compatibleProductSpecCodes(specCode: string): readonly string[] {
  return specCode === 'hotel-single' ? ['hotel-single', 'residence'] : [specCode];
}

export function productSpecCodesAllow(
  productSpecCodes: readonly string[],
  requestedSpecCode: string
): boolean {
  return (
    productSpecCodes.length === 0 ||
    compatibleProductSpecCodes(requestedSpecCode).some((code) => productSpecCodes.includes(code))
  );
}

/**
 * DBの商品spec_codesを個別商品適合の正本として残したまま、
 * 公開カタログ上だけ本体分類表のカテゴリー可否を交差させる。
 *
 * - DB spec_codes=[]: 商品側は全仕様共通 → カテゴリーが「選択」の仕様だけへ限定
 * - DB spec_codes!=[]: 商品側ホワイトリスト ∩ カテゴリー「選択」仕様
 * - hotel-single: residence互換resolverを通す
 * - 交差結果0件: []は「全仕様共通」の意味なので、非永続sentinelでdeny-allを表す
 */
export function effectiveCustomerSpecCodes(
  modelSlug: string,
  categoryCode: string,
  productSpecCodes: readonly string[]
): string[] {
  const businessItem = customerBusinessItemForCategory(categoryCode);
  if (!businessItem) return [...productSpecCodes];

  const modelRows = CUSTOMER_CATEGORY_MATRIX[modelSlug];
  if (!modelRows) return [CUSTOMER_SPEC_DENY_ALL];

  const categorySpecs = Object.entries(modelRows)
    .filter(([, businessItems]) => businessItems.includes(businessItem))
    .map(([specCode]) => specCode);

  const effective = categorySpecs.filter((specCode) =>
    productSpecCodesAllow(productSpecCodes, specCode)
  );

  return effective.length > 0 ? effective : [CUSTOMER_SPEC_DENY_ALL];
}

/** 公開シミュレーター用CatalogBundleに、カテゴリー行列を非破壊で反映する。 */
export function applyCustomerCategoryApplicability(bundle: CatalogBundle): CatalogBundle {
  const categoryById = new Map(bundle.categories.map((category) => [category.id, category.code]));
  const options: ProductOption[] = bundle.options.map((option) => {
    const categoryCode = categoryById.get(option.category_id);
    if (!categoryCode) return option;
    const spec_codes = effectiveCustomerSpecCodes(bundle.model.slug, categoryCode, option.spec_codes);
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
