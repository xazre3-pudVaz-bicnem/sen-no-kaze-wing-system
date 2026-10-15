import type { ProductOption } from '@/lib/domain/types';

/**
 * 電源仕様を登録時に必須とするカテゴリー。
 * 表示名ではなく、商品カテゴリーの技術コードで判定する。
 * 将来、IH・電気温水器・食洗機等を必須化するときはここへ追加する。
 */
export const POWER_SPEC_REQUIRED_CATEGORY_CODES = new Set(['aircon']);

export type ProductOptionWithPowerSpec = ProductOption & {
  /** メーカー公式資料に記載された電源仕様。DB列は既存互換のため nullable。 */
  power_spec?: string | null;
};

export function productRequiresPowerSpec(categoryCode: string | null | undefined): boolean {
  return Boolean(categoryCode && POWER_SPEC_REQUIRED_CATEGORY_CODES.has(categoryCode));
}

export function normalizePowerSpec(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

export function hasPowerSpec(value: unknown): boolean {
  return normalizePowerSpec(value) !== null;
}

export function productPowerSpec(option: ProductOption): string | null {
  return normalizePowerSpec((option as ProductOptionWithPowerSpec).power_spec);
}
