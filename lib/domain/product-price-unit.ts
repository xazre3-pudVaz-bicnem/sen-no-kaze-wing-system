import type { ProductOption } from '@/lib/domain/types';

export const PRODUCT_PRICE_UNIT_PRESETS = [
  '式',
  '台',
  '個',
  '枚',
  '本',
  'セット',
  'ケース',
  'm',
  '㎡',
  '坪',
  '人',
] as const;

export const PRODUCT_PRICE_UNIT_OTHER = '__other__';

export type ProductPriceUnitPreset = (typeof PRODUCT_PRICE_UNIT_PRESETS)[number];

const PRODUCT_PRICE_UNIT_DEFAULTS: Record<string, ProductPriceUnitPreset> = {
  roof: '㎡',
  'exterior-wall': '㎡',
  floor: 'ケース',
  'wall-ceiling': '㎡',
  carpentry: '式',
  'entrance-door': '台',
  'service-door': '台',
  sash: 'セット',
  'interior-door': '枚',
  ub: '台',
  toilet: '台',
  washbasin: '台',
  kitchen: '台',
  boiler: '台',
  aircon: '台',
  lighting: '台',
  smartlock: '台',
  'entrance-storage': '台',
  closet: 'セット',
  bed: '台',
  furniture: '台',
  appliances: '台',
  'exterior-parts': '個',
  'office-supplies': '個',
};

// メーカー参考価格は、メーカーごとに㎡・ケース・枚などが変わりやすい建材では自動選択しない。
// 「1台」が一般的な設備だけを保守的に既定値とする。
const MANUFACTURER_LIST_PRICE_UNIT_DEFAULTS: Partial<Record<string, ProductPriceUnitPreset>> = {
  ub: '台',
  toilet: '台',
  washbasin: '台',
  kitchen: '台',
  boiler: '台',
  aircon: '台',
  smartlock: '台',
  bed: '台',
  appliances: '台',
};

export function normalizeProductPriceUnit(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export function isProductPriceUnitPreset(value: string | null | undefined): value is ProductPriceUnitPreset {
  return Boolean(value && PRODUCT_PRICE_UNIT_PRESETS.includes(value as ProductPriceUnitPreset));
}

export function productPriceUnit(option: ProductOption): string | null {
  return normalizeProductPriceUnit(option.price_unit);
}

export function manufacturerListPriceUnit(option: ProductOption): string | null {
  return normalizeProductPriceUnit(option.list_price_unit);
}

export function productPriceUnitDefaults(categoryCode: string | null | undefined): {
  priceUnit: ProductPriceUnitPreset | null;
  listPriceUnit: ProductPriceUnitPreset | null;
} {
  const code = categoryCode?.trim() ?? '';
  return {
    priceUnit: PRODUCT_PRICE_UNIT_DEFAULTS[code] ?? null,
    listPriceUnit: MANUFACTURER_LIST_PRICE_UNIT_DEFAULTS[code] ?? null,
  };
}

export function formatPriceWithUnit(amount: number, unit: string | null | undefined): string {
  const formatted = `¥${amount.toLocaleString('ja-JP')}`;
  const normalizedUnit = normalizeProductPriceUnit(unit);
  return normalizedUnit ? `${formatted}／${normalizedUnit}` : formatted;
}
