import { describe, expect, it } from 'vitest';
import {
  isQuoteSelectableProduct,
  isSimulatorSelectableProduct,
  productLedgerState,
  productLedgerStateLabel,
  productSimulatorVisibleSetting,
} from '@/lib/domain/product-lifecycle';

describe('product lifecycle', () => {
  it('下書きは見積・シミュレーターの新規候補にしない', () => {
    const product = { status: 'draft' as const, archived_at: null, simulator_visible: true };
    expect(productLedgerState(product)).toBe('draft');
    expect(productLedgerStateLabel(product)).toBe('下書き');
    expect(isQuoteSelectableProduct(product)).toBe(false);
    expect(isSimulatorSelectableProduct(product)).toBe(false);
  });

  it('登録済みは見積候補になり、表示設定ONならシミュレーター候補になる', () => {
    const product = { status: 'published' as const, archived_at: null, simulator_visible: true };
    expect(productLedgerState(product)).toBe('registered');
    expect(productLedgerStateLabel(product)).toBe('登録済み');
    expect(isQuoteSelectableProduct(product)).toBe(true);
    expect(isSimulatorSelectableProduct(product)).toBe(true);
  });

  it('登録済みでも表示設定OFFなら見積だけで使える', () => {
    const product = { status: 'published' as const, archived_at: null, simulator_visible: false };
    expect(isQuoteSelectableProduct(product)).toBe(true);
    expect(productSimulatorVisibleSetting(product)).toBe(false);
    expect(isSimulatorSelectableProduct(product)).toBe(false);
  });

  it('取扱終了は履歴用状態として新規候補にしない', () => {
    const product = { status: 'published' as const, archived_at: '2026-10-15T00:00:00Z', simulator_visible: true };
    expect(productLedgerState(product)).toBe('retired');
    expect(productLedgerStateLabel(product)).toBe('取扱終了');
    expect(isQuoteSelectableProduct(product)).toBe(false);
    expect(isSimulatorSelectableProduct(product)).toBe(false);
  });

  it('migration未適用時の表示設定は従来互換でON扱いにする', () => {
    const product = { status: 'published' as const };
    expect(productSimulatorVisibleSetting(product)).toBe(true);
    expect(isSimulatorSelectableProduct(product)).toBe(true);
  });
});
