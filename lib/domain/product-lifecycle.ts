import type { ProductOption } from './types';

type ProductLifecycleFields = {
  status: ProductOption['status'];
  simulator_visible?: boolean | null;
  archived_at?: string | null;
};

export type ProductLedgerState = 'draft' | 'registered' | 'retired';

/** 商品の状態。DB の product_lifecycle_state と同じ（下書き＝status draft、取扱終了＝公開中かつ archived_at あり） */
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

/** 登録済みの商品は見積の商品台帳候補として使える（シミュレーター非表示も見積では選べる）。 */
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

/**
 * シミュレーターで新しく選べない理由（選べるなら null）。保存済みの明細として残すことはできる（DB の保存境界と同じ）。
 */
export function simulatorUnselectableReason(option: ProductLifecycleFields & { name: string }): string | null {
  const state = productLedgerState(option);
  if (state === 'retired') return `「${option.name}」は取扱終了のため、新しく選べません。`;
  if (state === 'draft') return `「${option.name}」は準備中のため選べません。`;
  if (!productSimulatorVisibleSetting(option)) return `「${option.name}」はシミュレーターでは新しく選べません。`;
  return null;
}

/**
 * 画面に出す候補：新しく選べる商品と、いま選ばれている（保存済みの）商品。
 * 取扱終了・非表示の商品は、選ばれている間だけ表示し、外したら候補から消える（足し直しは DB でも拒否される）。
 */
export function simulatorChoiceOptions<T extends ProductLifecycleFields & { id: string }>(options: T[], selectedIds: Iterable<string>): T[] {
  const selected = new Set(selectedIds);
  return options.filter((option) => isSimulatorSelectableProduct(option) || selected.has(option.id));
}

/** 商品の状態の機能（取扱終了・再開・シミュレーター表示）を有効にしてよいか（DB の migration が両方とも適用済みか） */
export interface ProductLifecycleCapability {
  /** options に simulator_visible / archived_at がある（20261015110000） */
  columns: boolean;
  /** 保存境界のトリガーがある（20261015113000） */
  guards: boolean;
}

export const PRODUCT_LIFECYCLE_UNAVAILABLE: ProductLifecycleCapability = { columns: false, guards: false };

export function productLifecycleEnabled(capability: ProductLifecycleCapability): boolean {
  return capability.columns && capability.guards;
}
