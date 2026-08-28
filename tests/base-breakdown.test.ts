import { describe, expect, it } from 'vitest';
import { BASE_BREAKDOWN_ITEMS, BASE_BREAKDOWN_TOTALS } from '@/lib/seed/base-breakdown';
import { MODEL_WING01_ID, seedBaseBreakdownItems, seedModels } from '@/lib/seed/catalog';

/**
 * 本体内訳マスター（20260827分類表見積書・お客様見積書＝売価）の検算。
 * 元シートの【本体価格計】と一致しなくなったら、生成スクリプトか元データの変化を疑う。
 */
describe('本体内訳マスター（分類表見積書 20260827）', () => {
  it('シートの本体価格計（売価）を再現する', () => {
    expect(BASE_BREAKDOWN_TOTALS['wing-01:hotel'].total).toBe(2_566_001);
    expect(BASE_BREAKDOWN_TOTALS['wing-01:residence'].total).toBe(2_305_554);
    expect(BASE_BREAKDOWN_TOTALS['wing-01:office'].total).toBe(2_264_432);
    expect(BASE_BREAKDOWN_TOTALS['box:hotel'].total).toBe(1_508_584);
    expect(BASE_BREAKDOWN_TOTALS['flat:office'].total).toBe(1_565_013);
  });

  it('明細合計＋諸費用15% ＝ 本体価格計（全モデル×仕様）', () => {
    for (const [key, t] of Object.entries(BASE_BREAKDOWN_TOTALS)) {
      const lines = BASE_BREAKDOWN_ITEMS.filter((b) => `${b.model_slug}:${b.spec_code}` === key).reduce(
        (sum, b) => sum + b.amount,
        0
      );
      expect(lines, key).toBe(t.lines);
      expect(Math.abs(Math.floor(lines * 0.15) - t.expense), key).toBeLessThanOrEqual(2);
      expect(lines + t.expense, key).toBe(t.total);
    }
  });

  it('数量 × 単価 ＝ 金額（丸め ±1 円）', () => {
    for (const b of BASE_BREAKDOWN_ITEMS) {
      expect(Math.abs(Math.round(b.quantity * b.unit_price) - b.amount), `${b.spec_code} ${b.name}`).toBeLessThanOrEqual(1);
    }
  });

  it('Wing の base_price はホテル仕様（既定）の明細合計と一致する', () => {
    const wing = seedModels.find((m) => m.id === MODEL_WING01_ID)!;
    expect(wing.base_price).toBe(BASE_BREAKDOWN_TOTALS['wing-01:hotel'].lines);
  });

  it('seed の内訳はモデル ID に解決されている', () => {
    expect(seedBaseBreakdownItems.length).toBe(BASE_BREAKDOWN_ITEMS.length);
    expect(seedBaseBreakdownItems.every((b) => b.base_model_id.startsWith('10000000-'))).toBe(true);
  });
});
