import type { CatalogBundle, ProductOption } from './types';

/** 公開カタログ内だけで使う「このカテゴリーでは選べる仕様なし」の非永続sentinel。 */
export const CUSTOMER_SPEC_DENY_ALL = '__customer_category_not_selectable__';

/**
 * 本体分類表 1シート目の「モデル × 仕様 × 項目 = 選択 / ×」を
 * お客様向けカテゴリー表示へ写すための実装表。
 *
 * ここで制御するのはカテゴリーの選択可否だけ。
 * 個々の商品がそのモデル・仕様・平面図に適合するかは、商品台帳の
 * base_model_id / spec_codes 等を別途尊重し、この表から推測しない。
 */
export const CUSTOMER_MATRIX_CATEGORY_CODES = [
  'roof',
  'exterior-wall',
  'floor',
  'wall-ceiling',
  'carpentry',
  'entrance-door',
  'service-door',
  'sash',
  'interior-door',
  'ub',
  'kitchen',
  'washbasin',
  'toilet',
] as const;

const STRUCTURE = ['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry'] as const;
const OPENINGS = ['entrance-door', 'service-door', 'sash'] as const;

const wingHotel = [...STRUCTURE, ...OPENINGS, 'interior-door', 'ub', 'washbasin', 'toilet'] as const;
const wingResidence = [...wingHotel, 'kitchen'] as const;
const wingRoom = [...STRUCTURE, 'interior-door'] as const;
const wingOffice = [...STRUCTURE, ...OPENINGS, 'ub', 'kitchen', 'toilet'] as const;
const boxWater = [...STRUCTURE, ...OPENINGS, 'ub', 'kitchen', 'washbasin', 'toilet'] as const;
const boxStorage = [...STRUCTURE, ...OPENINGS] as const;
const flatOffice = [...STRUCTURE, ...OPENINGS] as const;
const shellBase = ['roof', 'exterior-wall', ...OPENINGS] as const;

/**
 * spec_code は現行コードへ正規化して保持する。
 * BOX hotel-single は旧「ホテル・単身者用」標準見積コードで、分類表には同名行がない。
 * 現行互換を壊さないため、確定済み hotel / residence の和集合（= residence と同じ）を
 * 互換表示範囲として扱う。これは新しい業務仕様行を作るものではない。
 */
export const CUSTOMER_CATEGORY_MATRIX: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  'wing-01': {
    base: shellBase,
    hotel: wingHotel,
    residence: wingResidence,
    room: wingRoom,
    office: wingOffice,
  },
  box: {
    base: shellBase,
    hotel: wingHotel,
    residence: wingResidence,
    room: wingRoom,
    office: wingOffice,
    'hotel-single': wingResidence,
    'water-kit': boxWater,
    storage: boxStorage,
  },
  flat: {
    base: shellBase,
    office: flatOffice,
  },
};

const controlled = new Set<string>(CUSTOMER_MATRIX_CATEGORY_CODES);

/**
 * 本体分類表で制御するカテゴリーなら、model/spec 行に「選択」がある場合だけ true。
 * 制御対象外カテゴリーは既存挙動を維持する。
 * 未知の model/spec は、確定表にないカテゴリーを勝手に公開しないため fail closed。
 */
export function customerCategorySelectable(
  modelSlug: string,
  specCode: string,
  categoryCode: string
): boolean {
  if (!controlled.has(categoryCode)) return true;
  const row = CUSTOMER_CATEGORY_MATRIX[modelSlug]?.[specCode];
  return Boolean(row?.includes(categoryCode));
}

/**
 * DBの商品 spec_codes を個別商品適合の正本として残したまま、
 * 公開カタログ上だけ本体分類表のカテゴリー可否を交差させる。
 *
 * - DB spec_codes=[]: 商品側は全仕様共通 → カテゴリーが「選択」の仕様だけへ限定
 * - DB spec_codes!=[]: 商品側ホワイトリスト ∩ カテゴリー「選択」仕様
 * - 交差結果が0件: []は「全仕様共通」の意味なので、非永続sentinelでdeny-allを表す
 */
export function effectiveCustomerSpecCodes(
  modelSlug: string,
  categoryCode: string,
  productSpecCodes: readonly string[]
): string[] {
  if (!controlled.has(categoryCode)) return [...productSpecCodes];

  const modelRows = CUSTOMER_CATEGORY_MATRIX[modelSlug];
  if (!modelRows) return [CUSTOMER_SPEC_DENY_ALL];

  const categorySpecs = Object.entries(modelRows)
    .filter(([, categories]) => categories.includes(categoryCode))
    .map(([specCode]) => specCode);

  const effective =
    productSpecCodes.length === 0
      ? categorySpecs
      : productSpecCodes.filter((specCode) => categorySpecs.includes(specCode));

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
