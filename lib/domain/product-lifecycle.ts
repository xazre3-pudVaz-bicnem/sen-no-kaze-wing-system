import type { ProductOption } from './types';

type ProductLifecycleFields = {
  status: ProductOption['status'];
  simulator_visible?: boolean | null;
  archived_at?: string | null;
};

export type ProductLedgerState = 'draft' | 'registered' | 'retired';

export function productLedgerState(option: ProductLifecycleFields): ProductLedgerState {
  if (option.status === 'draft') return 'draft';
  return option.archived_at ? 'retired' : 'registered';
}

export function productLedgerStateLabel(option: ProductLifecycleFields): string {
  const state = productLedgerState(option);
  if (state === 'draft') return '下書き';
  if (state === 'retired') return '取扱終了';
  return '登録済み';
}

/** 登録済みの商品は見積の商品台帳候補として使える。 */
export function isQuoteSelectableProduct(option: ProductLifecycleFields): boolean {
  return productLedgerState(option) === 'registered';
}

/** migration 未適用時は従来互換で表示対象とする。 */
export function productSimulatorVisibleSetting(option: ProductLifecycleFields): boolean {
  return option.simulator_visible !== false;
}

/** お客様向けシミュレーターに新規候補として出せる商品。 */
export function isSimulatorSelectableProduct(option: ProductLifecycleFields): boolean {
  return isQuoteSelectableProduct(option) && productSimulatorVisibleSetting(option);
}
