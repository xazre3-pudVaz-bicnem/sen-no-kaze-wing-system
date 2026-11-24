/**
 * 本体仕様マトリクスの初期データ（ローカル検証モード専用）。
 *
 * 本番・共有 DB の正本は migration `20261013110000_matrix_identity_foundation.sql` の初期登録と、
 * その後の管理画面での変更。ここはローカル検証モードの空 DB を作るときだけ使う。
 * PR A 時点の15項目・6行の歴史的seedは残し、#707 の現行追加項目だけ下の拡張seedで適用する。
 */
import type { BaseModel, MatrixCell, MatrixItem, MatrixRow, MatrixSize, MatrixSpec, OptionCategory, SpecMatrix } from '@/lib/domain/types';

export const MATRIX_SPEC_SEED: MatrixSpec[] = [
  { code: 'hotel', label: 'ホテル仕様', sort_order: 10, status: 'active' },
  { code: 'residence', label: '住居仕様', sort_order: 20, status: 'active' },
  { code: 'office', label: '事務所仕様', sort_order: 30, status: 'active' },
  { code: 'water-kit', label: '水回りBOX', sort_order: 40, status: 'active' },
];

export const MATRIX_SIZE_SEED: MatrixSize[] = [
  { code: '3640x4550', width_mm: 3640, depth_mm: 4550, label: '3,640×4,550', sort_order: 10, status: 'active' },
  { code: '2100x4550', width_mm: 2100, depth_mm: 4550, label: '2,100×4,550', sort_order: 20, status: 'active' },
];

export const MATRIX_ITEM_SEED: MatrixItem[] = [
  { code: 'roof-exterior', label: '屋根・外壁', sort_order: 10, status: 'active' },
  { code: 'interior', label: '内装', sort_order: 20, status: 'active' },
  { code: 'entrance-door', label: '玄関ドア', sort_order: 30, status: 'active' },
  { code: 'sash', label: 'サッシ', sort_order: 40, status: 'active' },
  { code: 'bath', label: 'UB・シャワー', sort_order: 50, status: 'active' },
  { code: 'kitchen', label: 'キッチン', sort_order: 60, status: 'active' },
  { code: 'washbasin', label: '洗面', sort_order: 70, status: 'active' },
  { code: 'toilet', label: 'トイレ', sort_order: 80, status: 'active' },
  { code: 'boiler', label: '給湯器', sort_order: 90, status: 'active' },
  { code: 'entrance-storage', label: '玄関収納', sort_order: 100, status: 'active' },
  { code: 'interior-door', label: '室内建具', sort_order: 110, status: 'active' },
  { code: 'closet', label: 'クローゼット', sort_order: 120, status: 'active' },
  { code: 'bed', label: 'ベッド', sort_order: 130, status: 'active' },
  { code: 'furnishings', label: '備品', sort_order: 140, status: 'active' },
  { code: 'other', label: 'その他', sort_order: 150, status: 'active' },
];

// The original 15 items are the immutable historical PR A seed (20261013110000).
// The current local simulator includes the later two independently selectable items.
// Do not change the old migration or MATRIX_ITEM_SEED to rewrite the PR A baseline.
export const MATRIX_ITEM_EXTENSION_707: MatrixItem[] = [
  { code: 'aircon', label: '空調（エアコン）', sort_order: 145, status: 'active' },
  { code: 'lighting', label: '照明器具', sort_order: 146, status: 'active' },
];
export const MATRIX_CURRENT_ITEM_SEED: MatrixItem[] = [...MATRIX_ITEM_SEED, ...MATRIX_ITEM_EXTENSION_707]
  .sort((a, b) => a.sort_order - b.sort_order);

/** 機種 slug・仕様・サイズ・防火の可否と、選択できる項目（列挙していない項目は選択不可） */
export const MATRIX_ROW_SEED: Array<{
  model_slug: string;
  spec_code: string;
  size_code: string;
  fire_selectable: boolean;
  selectable_items: string[];
}> = [
  {
    model_slug: 'wing-01',
    spec_code: 'hotel',
    size_code: '3640x4550',
    fire_selectable: true,
    selectable_items: ['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'washbasin', 'toilet', 'boiler', 'entrance-storage', 'interior-door', 'bed', 'furnishings', 'other'],
  },
  {
    model_slug: 'wing-01',
    spec_code: 'residence',
    size_code: '3640x4550',
    fire_selectable: true,
    selectable_items: ['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'kitchen', 'washbasin', 'toilet', 'boiler', 'entrance-storage', 'interior-door', 'bed', 'furnishings', 'other'],
  },
  {
    model_slug: 'wing-01',
    spec_code: 'office',
    size_code: '3640x4550',
    fire_selectable: true,
    selectable_items: ['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'kitchen', 'toilet', 'boiler', 'furnishings', 'other'],
  },
  {
    model_slug: 'box',
    spec_code: 'hotel',
    size_code: '2100x4550',
    fire_selectable: true,
    selectable_items: ['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'washbasin', 'toilet', 'boiler', 'entrance-storage', 'interior-door', 'bed', 'furnishings', 'other'],
  },
  {
    model_slug: 'box',
    spec_code: 'water-kit',
    size_code: '2100x4550',
    fire_selectable: true,
    selectable_items: ['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'kitchen', 'washbasin', 'toilet', 'boiler'],
  },
  {
    model_slug: 'flat',
    spec_code: 'office',
    size_code: '2100x4550',
    fire_selectable: false,
    selectable_items: ['roof-exterior', 'interior', 'entrance-door', 'sash'],
  },
];

/**
 * Category → Matrix Item の確定対応（PR B の migration `20261013130000` と同じ 24 カテゴリー）。
 * 対応の無いカテゴリー（防火・断熱・別途工事・自由商品など）はマトリクスで制限しない。
 */
export const MATRIX_CATEGORY_ITEM_SEED: ReadonlyArray<readonly [categoryCode: string, itemCode: string]> = [
  ['roof', 'roof-exterior'], ['exterior-wall', 'roof-exterior'],
  ['floor', 'interior'], ['wall-ceiling', 'interior'], ['carpentry', 'interior'],
  ['entrance-door', 'entrance-door'],
  ['sash', 'sash'], ['service-door', 'sash'],
  ['ub', 'bath'], ['kitchen', 'kitchen'], ['washbasin', 'washbasin'], ['toilet', 'toilet'], ['boiler', 'boiler'],
  ['entrance-storage', 'entrance-storage'], ['interior-door', 'interior-door'], ['closet', 'closet'], ['bed', 'bed'],
  ['furniture', 'furnishings'], ['appliances', 'furnishings'], ['office-supplies', 'furnishings'],
  ['aircon', 'other'], ['lighting', 'other'], ['smartlock', 'other'], ['exterior-parts', 'other'],
];

// The historical category mapping remains unchanged above; the current mapping
// matches #707's migration, which re-maps only aircon and lighting.
export const MATRIX_CURRENT_CATEGORY_ITEM_SEED: ReadonlyArray<readonly [string, string]> =
  MATRIX_CATEGORY_ITEM_SEED.map(([categoryCode, itemCode]) => [
    categoryCode,
    categoryCode === 'aircon' || categoryCode === 'lighting' ? categoryCode : itemCode,
  ] as const);

/** ローカル検証モードの空 DB 用に、機種 ID・カテゴリー ID を解決したマトリクスを作る（無い機種・カテゴリーは作らない） */
export function buildSeedMatrix(
  models: Pick<BaseModel, 'id' | 'slug'>[],
  categories: Pick<OptionCategory, 'id' | 'code'>[] = []
): SpecMatrix {
  const rows: MatrixRow[] = [];
  const cells: MatrixCell[] = [];
  for (const [index, seed] of MATRIX_ROW_SEED.entries()) {
    const model = models.find((candidate) => candidate.slug === seed.model_slug);
    if (!model) continue;
    // 画面・入力検証が UUID を前提にできるよう、ローカルでも固定の UUID を使う
    const id = `00000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`;
    rows.push({
      id,
      base_model_id: model.id,
      spec_code: seed.spec_code,
      size_code: seed.size_code,
      fire_selectable: seed.fire_selectable,
      status: 'active',
      lock_version: 1,
    });
    for (const item of MATRIX_CURRENT_ITEM_SEED) {
      // 707 initial state: inherit the legacy "other" flag for both new items.
      const isNew = item.code === 'aircon' || item.code === 'lighting';
      cells.push({
        matrix_row_id: id,
        matrix_item_code: item.code,
        selectable: seed.selectable_items.includes(isNew ? 'other' : item.code),
      });
    }
  }
  return {
    specs: MATRIX_SPEC_SEED.map((row) => ({ ...row })),
    sizes: MATRIX_SIZE_SEED.map((row) => ({ ...row })),
    items: MATRIX_CURRENT_ITEM_SEED.map((row) => ({ ...row })),
    rows,
    cells,
    categoryItems: MATRIX_CURRENT_CATEGORY_ITEM_SEED.flatMap(([categoryCode, itemCode]) => {
      const category = categories.find((candidate) => candidate.code === categoryCode);
      return category ? [{ category_id: category.id, matrix_item_code: itemCode }] : [];
    }),
  };
}
