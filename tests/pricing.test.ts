import { describe, expect, it } from 'vitest';
import { baseTotalOf, computePricing } from '@/lib/domain/pricing';
import { FREE_PRODUCT_CATEGORY_CODE, type ProductOption } from '@/lib/domain/types';
import { MODEL_BOX_ID, MODEL_WING01_ID, O, seedCategories, seedModels, seedOptions } from '@/lib/seed/catalog';

const wing = seedModels.find((m) => m.id === MODEL_WING01_ID)!;
const box = seedModels.find((m) => m.id === MODEL_BOX_ID)!;

const codes = (...list: string[]) => list.map((code) => ({ option_id: seedOptions.find((o) => o.code === code)!.id }));

describe('computePricing（見積書テンプレートの計算構造）', () => {
  it('本体価格計 ＝ 本体一式 ＋ 諸費用15%（片ウィング【単身者用】 2,479,818）', () => {
    expect(baseTotalOf(wing)).toBe(2_479_818);
    const r = computePricing(wing, seedOptions, seedCategories, []);
    expect(r.base_price).toBe(2_156_364);
    expect(r.base_expense).toBe(323_454);
    expect(r.base_total).toBe(2_479_818);
  });

  it('片ウィング【ホテルUB】のオプション構成でオプション価格計を再現する（諸費用15%）', () => {
    // シート: 内装 613,338 + 設備 1,951,725 + 造作 312,500 = 2,877,563 → 諸費用 431,634 → 計 3,309,197
    // ただしシートは洗面器が 2 行（67,500 と 69,225）重複計上されているため、本システムでは 1 台分（69,225）のみ。
    const r = computePricing(
      wing,
      seedOptions,
      seedCategories,
      codes('interior-hotel-wing', 'carpentry-full-wing', 'ub-1216', 'toilet-washlet', 'washbasin-kb', 'faucet-kb', 'gas-boiler-16', 'aircon', 'smart-key', 'shoe-box', 'folding-bed', 'hanger-pipe')
    );
    expect(r.option_subtotal).toBe(2_877_563 - 67_500);
    expect(r.option_expense).toBe(Math.floor((2_877_563 - 67_500) * 0.15));
    expect(r.option_total).toBe(r.option_subtotal + r.option_expense);
  });

  it('値引き等調整額で千円未満を切り捨て、消費税10%を加算する', () => {
    const r = computePricing(wing, seedOptions, seedCategories, codes('interior-standard-wing', 'carpentry-full-wing'));
    // 本体計 2,479,818 + オプション (515,890+312,500)=828,390 ×1.15 = 952,648 → raw 3,432,466
    expect(r.subtotal_raw).toBe(3_432_466);
    expect(r.adjustment).toBe(-466);
    expect(r.subtotal).toBe(3_432_000);
    expect(r.tax).toBe(343_200);
    expect(r.total).toBe(3_775_200);
  });

  it('ユニットバスを外すと金額が元に戻る（諸費用込みの差額）', () => {
    const base = computePricing(wing, seedOptions, seedCategories, codes('gas-boiler-16'));
    const withUb = computePricing(wing, seedOptions, seedCategories, codes('gas-boiler-16', 'ub-1216'));
    expect(withUb.option_total - base.option_total).toBe(570_000 + Math.floor(570_000 * 0.15));
  });

  it('別途工事（要見積）は 0 円で集計され、フラグが立つ', () => {
    const r = computePricing(wing, seedOptions, seedCategories, codes('sw-transport', 'sw-electric'));
    expect(r.installation_subtotal).toBe(0);
    expect(r.has_price_on_request).toBe(true);
    expect(r.lines.every((l) => l.is_installation)).toBe(true);
  });

  it('他モデル専用オプション・未公開・重複 ID は金額に乗らない', () => {
    const r = computePricing(box, seedOptions, seedCategories, [
      { option_id: O.interiorStdWing }, // Wing 専用
      { option_id: O.interiorStdBox },
      { option_id: O.interiorStdBox },
      { option_id: 'not-exist' },
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.option_subtotal).toBe(321_654);
  });
});

describe('フリー商品（代理店の自社商品）', () => {
  const model = seedModels.find((m) => m.id === MODEL_WING01_ID)!;
  const freeCat = seedCategories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE)!;
  const bed: ProductOption = {
    id: '90000000-0000-4000-8000-000000000001',
    base_model_id: null,
    category_id: freeCat.id,
    code: 'dealer-bed',
    name: '代理店オリジナルベッド',
    description: null,
    price: 100_000,
    image_url: null,
    selection_type: 'checkbox',
    is_required: false,
    is_default: false,
    is_installation: false,
    price_on_request: false,
    spec_codes: [],
    owner_id: 'dealer-1',
    manufacturer: null,
    model_no: null,
    size_note: null,
    list_price: null,
    highlight: null,
    preview_key: null,
    affects_views: [],
    sort_order: 1,
    status: 'published',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const options = [...seedOptions, bed];

  it('諸費用（15%）が乗らず、オプション価格計に含まれない', () => {
    const withoutBed = computePricing(model, options, seedCategories, []);
    const withBed = computePricing(model, options, seedCategories, [{ option_id: bed.id }]);
    expect(withBed.option_subtotal).toBe(withoutBed.option_subtotal);
    expect(withBed.option_expense).toBe(withoutBed.option_expense);
    expect(withBed.free_subtotal).toBe(100_000);
    // 諸費用なしでそのまま小計に乗る（千円未満切捨てのため誤差 ±1,000）
    expect(withBed.subtotal_raw - withoutBed.subtotal_raw).toBe(100_000);
  });

  it('フリー商品は別途工事の内数として扱われ、明細にフラグが立つ', () => {
    const r = computePricing(model, options, seedCategories, [{ option_id: bed.id }]);
    const line = r.lines.find((l) => l.code === 'dealer-bed')!;
    expect(line.is_free_product).toBe(true);
    expect(line.is_installation).toBe(true);
    expect(line.category_code).toBe(FREE_PRODUCT_CATEGORY_CODE);
    expect(r.installation_subtotal).toBeGreaterThanOrEqual(r.free_subtotal);
  });
});
