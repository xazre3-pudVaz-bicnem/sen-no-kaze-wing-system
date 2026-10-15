import type { CatalogBundle, ProductOption } from '@/lib/domain/types';

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

/**
 * 顧客向けシミュレーターと、その管理画面プレビューで同じ候補集合を使う。
 * Presetに古いoption codeが残っていても、buildPresetSelection() はctx.optionsに無いcodeを読み飛ばすため、
 * 過去Presetを破壊せずに現在の取扱商品だけを反映できる。
 */
export function filterCatalogBundleForSimulator(bundle: CatalogBundle): CatalogBundle {
  const options = bundle.options.filter((option) => isOptionVisibleInSimulator(option as ProductLifecycleOption));
  const optionIds = new Set(options.map((option) => option.id));
  const variantGroups = bundle.variantGroups.filter((group) => optionIds.has(group.option_id));
  const variantGroupIds = new Set(variantGroups.map((group) => group.id));

  return {
    ...bundle,
    options,
    // 依存元が候補に残る限りルールは保持する。前提商品が非表示なら選択を明示的に拒否する。
    dependencies: bundle.dependencies.filter((dependency) => optionIds.has(dependency.option_id)),
    conflicts: bundle.conflicts.filter(
      (conflict) => optionIds.has(conflict.option_id) && optionIds.has(conflict.conflicts_with_option_id)
    ),
    variantGroups,
    variantChoices: bundle.variantChoices.filter((choice) => variantGroupIds.has(choice.group_id)),
  };
}

/** migration適用前は項目自体が無い。操作UIを安全に無効化するための判定。 */
export function hasProductLifecycleColumns(option: ProductLifecycleOption): boolean {
  return Object.prototype.hasOwnProperty.call(option, 'simulator_visible') && Object.prototype.hasOwnProperty.call(option, 'archived_at');
}

export function productLifecycleLabel(option: ProductLifecycleOption): '下書き' | '登録済み' | '取扱終了' {
  if (option.status !== 'published') return '下書き';
  return isOptionArchived(option) ? '取扱終了' : '登録済み';
}
