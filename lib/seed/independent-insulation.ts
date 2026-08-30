import type { OptionCategory, ProductOption } from '@/lib/domain/types';
import { MODEL_WING01_ID, seedCatalog } from './catalog';

const NOW = '2026-08-30T00:00:00.000Z';

const CATEGORY_IDS = {
  floor: '29000000-0000-4000-8000-000000000001',
  wall: '29000000-0000-4000-8000-000000000002',
  ceiling: '29000000-0000-4000-8000-000000000003',
} as const;

const OPTION_IDS = {
  floorMirafoam: '39000000-0000-4000-8000-000000000001',
  wallStyroHotelBase: '39000000-0000-4000-8000-000000000002',
  wallGlassHotelChange: '39000000-0000-4000-8000-000000000003',
  wallGlassStandard: '39000000-0000-4000-8000-000000000004',
  wallStyroChange: '39000000-0000-4000-8000-000000000005',
  ceilingStyroHotelBase: '39000000-0000-4000-8000-000000000006',
  ceilingGlassHotelChange: '39000000-0000-4000-8000-000000000007',
  ceilingGlassStandard: '39000000-0000-4000-8000-000000000008',
  ceilingStyroChange: '39000000-0000-4000-8000-000000000009',
} as const;

const category = (id: string, code: string, name: string, sortOrder: number): OptionCategory => ({
  id,
  code,
  name,
  group_code: 'finish',
  group_name: '内外装仕上げ',
  group_sort: 2,
  description: `${name}を個別に選択します。`,
  selection_mode: 'single',
  finish_level: 'shell',
  is_required: true,
  customer_visible: true,
  sort_order: sortOrder,
  status: 'published',
});

const option = (
  id: string,
  categoryId: string,
  code: string,
  name: string,
  specCodes: string[],
  sortOrder: number,
  priceOnRequest = false,
  highlight: string | null = null
): ProductOption => ({
  id,
  base_model_id: MODEL_WING01_ID,
  category_id: categoryId,
  code,
  name,
  description: priceOnRequest
    ? '選択は可能です。現在の標準仕様から変更する場合の差額は、正式見積で確認します。'
    : '現在の仕様に含まれる断熱材です。',
  price: 0,
  image_url: null,
  selection_type: 'radio',
  is_required: false,
  is_default: false,
  is_installation: false,
  price_on_request: priceOnRequest,
  spec_codes: specCodes,
  owner_id: null,
  manufacturer: null,
  model_no: null,
  size_note: '90mm',
  list_price: null,
  highlight,
  preview_key: null,
  affects_views: [],
  sort_order: sortOrder,
  status: 'published',
  created_at: NOW,
  updated_at: NOW,
});

const CATEGORIES: OptionCategory[] = [
  category(CATEGORY_IDS.floor, 'insulation-floor', '床断熱', 4),
  category(CATEGORY_IDS.wall, 'insulation-wall', '壁断熱', 5),
  category(CATEGORY_IDS.ceiling, 'insulation-ceiling', '天井断熱', 6),
];

const OPTIONS: ProductOption[] = [
  option(
    OPTION_IDS.floorMirafoam,
    CATEGORY_IDS.floor,
    'insulation-floor-mirafoam-90',
    '床用ミラフォーム 90mm',
    [],
    1,
    false,
    '標準'
  ),
  option(
    OPTION_IDS.wallStyroHotelBase,
    CATEGORY_IDS.wall,
    'insulation-wall-styrofoam-90-hotel-base',
    '壁用スタイロフォーム 90mm',
    ['hotel'],
    1,
    false,
    '標準'
  ),
  option(
    OPTION_IDS.wallGlassHotelChange,
    CATEGORY_IDS.wall,
    'insulation-wall-glasswool-90-hotel-change',
    '壁グラスウール 90mm',
    ['hotel'],
    2,
    true,
    '仕様変更'
  ),
  option(
    OPTION_IDS.wallGlassStandard,
    CATEGORY_IDS.wall,
    'insulation-wall-glasswool-90-standard',
    '壁グラスウール 90mm',
    ['residence', 'office'],
    1,
    false,
    '標準'
  ),
  option(
    OPTION_IDS.wallStyroChange,
    CATEGORY_IDS.wall,
    'insulation-wall-styrofoam-90-change',
    '壁用スタイロフォーム 90mm',
    ['residence', 'office'],
    2,
    true,
    '仕様変更'
  ),
  option(
    OPTION_IDS.ceilingStyroHotelBase,
    CATEGORY_IDS.ceiling,
    'insulation-ceiling-styrofoam-90-hotel-base',
    '天井用スタイロフォーム 90mm',
    ['hotel'],
    1,
    false,
    '標準'
  ),
  option(
    OPTION_IDS.ceilingGlassHotelChange,
    CATEGORY_IDS.ceiling,
    'insulation-ceiling-glasswool-90-hotel-change',
    '天井グラスウール 90mm',
    ['hotel'],
    2,
    true,
    '仕様変更'
  ),
  option(
    OPTION_IDS.ceilingGlassStandard,
    CATEGORY_IDS.ceiling,
    'insulation-ceiling-glasswool-90-standard',
    '天井グラスウール 90mm',
    ['residence', 'office'],
    1,
    false,
    '標準'
  ),
  option(
    OPTION_IDS.ceilingStyroChange,
    CATEGORY_IDS.ceiling,
    'insulation-ceiling-styrofoam-90-change',
    '天井用スタイロフォーム 90mm',
    ['residence', 'office'],
    2,
    true,
    '仕様変更'
  ),
];

const PRESET_CODES: Record<string, string[]> = {
  hotel: [
    'insulation-floor-mirafoam-90',
    'insulation-wall-styrofoam-90-hotel-base',
    'insulation-ceiling-styrofoam-90-hotel-base',
  ],
  residence: [
    'insulation-floor-mirafoam-90',
    'insulation-wall-glasswool-90-standard',
    'insulation-ceiling-glasswool-90-standard',
  ],
  office: [
    'insulation-floor-mirafoam-90',
    'insulation-wall-glasswool-90-standard',
    'insulation-ceiling-glasswool-90-standard',
  ],
};

/**
 * 既存の商品台帳を壊さず、断熱だけ床・壁・天井の独立カテゴリーとして追加する。
 * 本番DB側は同内容のマイグレーションを適用する。ローカル/デモモードではこの補助シードを使う。
 */
export function installIndependentInsulationSeed(): void {
  const oldCategory = seedCatalog.categories.find((row) => row.code === 'insulation');
  if (oldCategory) oldCategory.customer_visible = false;

  for (const row of CATEGORIES) {
    if (!seedCatalog.categories.some((existing) => existing.id === row.id || existing.code === row.code)) {
      seedCatalog.categories.push(row);
    }
  }
  for (const row of OPTIONS) {
    if (!seedCatalog.options.some((existing) => existing.id === row.id || existing.code === row.code)) {
      seedCatalog.options.push(row);
    }
  }

  const wing = seedCatalog.models.find((model) => model.id === MODEL_WING01_ID);
  if (!wing) return;
  for (const preset of wing.presets ?? []) {
    const wanted = PRESET_CODES[preset.code];
    if (!wanted) continue;
    const withoutIndependent = preset.option_codes.filter(
      (code) => !code.startsWith('insulation-floor-') && !code.startsWith('insulation-wall-') && !code.startsWith('insulation-ceiling-')
    );
    preset.option_codes = [...withoutIndependent, ...wanted];
  }
}

installIndependentInsulationSeed();
