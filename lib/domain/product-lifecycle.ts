import type { ProductOption } from '@/lib/domain/types';

/**
 * 20261015100000 migrationで追加する商品ライフサイクル項目。
 * アプリがmigrationより先にdeployされても既存商品を従来どおり扱えるよう、
 * 読み取り側はoptionalとして扱う。
 */
export type ProductLifecycleOption = ProductOption & {
  simulator_visible?: boolean;
  archived_at?: string | null;
};

/** 下書きではなく、新しい見積の商品候補として利用できる登録済み・取扱中の商品。 */
export function isOptionAvailableForEstimate(option: ProductLifecycleOption): boolean {
  return option.status === 'published' && !option.archived_at;
}

/** お客様シミュレーターへ出してよい、登録済み・取扱中かつ表示ONの商品。 */
export function isOptionVisibleInSimulator(option: ProductLifecycleOption): boolean {
  return isOptionAvailableForEstimate(option) && option.simulator_visible !== false;
}

export function isOptionArchived(option: ProductLifecycleOption): boolean {
  return option.status === 'published' && Boolean(option.archived_at);
}

/** migration適用前は項目自体が無い。操作UIを安全に無効化するための判定。 */
export function hasProductLifecycleColumns(option: ProductLifecycleOption): boolean {
  return Object.prototype.hasOwnProperty.call(option, 'simulator_visible') && Object.prototype.hasOwnProperty.call(option, 'archived_at');
}

export function productLifecycleLabel(option: ProductLifecycleOption): '下書き' | '登録済み' | '取扱終了' {
  if (option.status !== 'published') return '下書き';
  return isOptionArchived(option) ? '取扱終了' : '登録済み';
}
