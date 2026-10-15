import { describe, expect, it } from 'vitest';
import {
  hasProductLifecycleColumns,
  isOptionArchived,
  isOptionAvailableForEstimate,
  isOptionVisibleInSimulator,
  productLifecycleLabel,
  type ProductLifecycleOption,
} from '@/lib/domain/product-lifecycle';

function option(
  status: 'draft' | 'published',
  extra: Partial<ProductLifecycleOption> = {}
): ProductLifecycleOption {
  return {
    status,
    ...extra,
  } as ProductLifecycleOption;
}

describe('商品ライフサイクル', () => {
  it('下書きは見積・シミュレーターの新規候補にならない', () => {
    const target = option('draft');
    expect(productLifecycleLabel(target)).toBe('下書き');
    expect(isOptionAvailableForEstimate(target)).toBe(false);
    expect(isOptionVisibleInSimulator(target)).toBe(false);
  });

  it('登録済み・取扱中は見積で選択できる', () => {
    const target = option('published', { archived_at: null, simulator_visible: true });
    expect(productLifecycleLabel(target)).toBe('登録済み');
    expect(isOptionAvailableForEstimate(target)).toBe(true);
    expect(isOptionVisibleInSimulator(target)).toBe(true);
  });

  it('シミュレーター非表示でも登録済み・取扱中なら見積では選択できる', () => {
    const target = option('published', { archived_at: null, simulator_visible: false });
    expect(isOptionAvailableForEstimate(target)).toBe(true);
    expect(isOptionVisibleInSimulator(target)).toBe(false);
  });

  it('取扱終了は新しい見積・シミュレーター候補から外す', () => {
    const target = option('published', { archived_at: '2026-10-15T00:00:00.000Z', simulator_visible: true });
    expect(isOptionArchived(target)).toBe(true);
    expect(productLifecycleLabel(target)).toBe('取扱終了');
    expect(isOptionAvailableForEstimate(target)).toBe(false);
    expect(isOptionVisibleInSimulator(target)).toBe(false);
  });

  it('migration適用前の既存商品は従来どおり登録済み・表示対象として扱う', () => {
    const target = option('published');
    expect(hasProductLifecycleColumns(target)).toBe(false);
    expect(isOptionAvailableForEstimate(target)).toBe(true);
    expect(isOptionVisibleInSimulator(target)).toBe(true);
  });

  it('migration適用後は両方の項目が存在することを検出する', () => {
    const target = option('published', { archived_at: null, simulator_visible: true });
    expect(hasProductLifecycleColumns(target)).toBe(true);
  });
});
