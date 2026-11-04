import { describe, expect, it } from 'vitest';
import {
  isQuoteSelectableProduct,
  isSimulatorSelectableProduct,
  PRODUCT_LIFECYCLE_UNAVAILABLE,
  productLedgerState,
  productLedgerStateLabel,
  productLifecycleEnabled,
  productSimulatorVisibleSetting,
  simulatorChoiceOptions,
  simulatorUnselectableReason,
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

  it('販売停止・廃番は履歴用状態として新規候補にしない（2026-10-19 の先方回答：#500 の取扱終了を販売停止と呼び、廃番を分ける）', () => {
    const product = { status: 'published' as const, archived_at: '2026-10-15T00:00:00Z', simulator_visible: true };
    expect(productLedgerState(product)).toBe('retired');
    expect(productLedgerStateLabel(product)).toBe('販売停止');
    expect(isQuoteSelectableProduct(product)).toBe(false);
    expect(isSimulatorSelectableProduct(product)).toBe(false);
    const discontinued = { ...product, discontinued_at: '2026-10-20T00:00:00Z' };
    expect(productLedgerState(discontinued)).toBe('retired');
    expect(productLedgerStateLabel(discontinued)).toBe('廃番');
    expect(isQuoteSelectableProduct(discontinued)).toBe(false);
  });

  it('migration未適用時の表示設定は従来互換でON扱いにする', () => {
    const product = { status: 'published' as const };
    expect(productSimulatorVisibleSetting(product)).toBe(true);
    expect(isSimulatorSelectableProduct(product)).toBe(true);
  });

  it('シミュレーターで新しく選べない理由を状態ごとに返す（選べる商品は null）', () => {
    const product = { name: '照明A', status: 'published' as const, archived_at: null, simulator_visible: true };
    expect(simulatorUnselectableReason(product)).toBeNull();
    expect(simulatorUnselectableReason({ ...product, simulator_visible: false })).toBe('「照明A」はシミュレーターでは新しく選べません。');
    expect(simulatorUnselectableReason({ ...product, archived_at: '2026-10-15T00:00:00Z' })).toBe('「照明A」は販売停止中のため、新しく選べません。');
    expect(simulatorUnselectableReason({ ...product, archived_at: '2026-10-15T00:00:00Z', discontinued_at: '2026-10-20T00:00:00Z' })).toBe('「照明A」は廃番のため、新しく選べません。');
    // 販売停止は表示設定より優先して伝える（再開しない限り選べないため）
    expect(simulatorUnselectableReason({ ...product, archived_at: '2026-10-15T00:00:00Z', simulator_visible: false })).toContain('販売停止中');
    expect(simulatorUnselectableReason({ ...product, status: 'draft' as const })).toBe('「照明A」は準備中のため選べません。');
  });

  it('シミュレーターの候補は、新しく選べる商品と、いま選ばれている（保存済みの）商品だけにする', () => {
    const options = [
      { id: 'visible', status: 'published' as const, archived_at: null, simulator_visible: true },
      { id: 'hidden', status: 'published' as const, archived_at: null, simulator_visible: false },
      { id: 'retired', status: 'published' as const, archived_at: '2026-10-15T00:00:00Z', simulator_visible: true },
      { id: 'draft', status: 'draft' as const, archived_at: null, simulator_visible: true },
    ];
    expect(simulatorChoiceOptions(options, []).map((o) => o.id)).toEqual(['visible']);
    // 保存済みの非表示・取扱終了の明細は、選ばれている間だけ表示する（外すと候補から消える）
    expect(simulatorChoiceOptions(options, ['hidden', 'retired']).map((o) => o.id)).toEqual(['visible', 'hidden', 'retired']);
    expect(simulatorChoiceOptions(options, new Set(['retired'])).map((o) => o.id)).toEqual(['visible', 'retired']);
  });

  it('商品の状態の機能は、列と保存境界の両方の migration が適用済みのときだけ有効にする', () => {
    expect(productLifecycleEnabled({ columns: true, guards: true })).toBe(true);
    // 列だけ（20261015110000 のみ）では、取扱終了を DB で止められないので有効にしない
    expect(productLifecycleEnabled({ columns: true, guards: false })).toBe(false);
    expect(productLifecycleEnabled({ columns: false, guards: false })).toBe(false);
    expect(productLifecycleEnabled(PRODUCT_LIFECYCLE_UNAVAILABLE)).toBe(false);
  });
});
