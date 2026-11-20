import { describe, it, expect, vi } from 'vitest';

const state = vi.hoisted(() => ({ versions: new Map<string, number>(), fail: true, calls: [] as string[], throwAt: '', refresh: vi.fn(), productThrow: false }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ updateTag: state.refresh }));
vi.mock('@/lib/data/public-catalog', () => ({ CATALOG_TAG: 'catalog' }));
vi.mock('@/lib/data/store', () => ({ isLocalMode: () => false }));
vi.mock('@/lib/data/legacy-prices', () => ({
  withLegacyChoicePrices: async (rows: { id: string }[]) => rows.map((row) => ({ ...row, extra_price: 0 })),
  withLegacyOptionPrices: async (rows: { id: string }[]) => rows.map((row) => ({ ...row, price: 5000 })),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const data = table === 'options' ? { id: 'p', status: 'published', price_on_request: false }
        : table === 'option_standard_cost_versions' || table === 'option_hq_standard_costs' ? null
        : table === 'option_variant_groups' ? [{ id: 'g' }]
          : table === 'option_variant_choices' ? [{ id: 'a', price_on_request: false }, { id: 'b', price_on_request: false }]
            : [...state.versions].map(([id, cost]) => ({ id: 'v-' + id, variant_choice_id: id, cost_adjustment: cost }));
      const q = {
        select: () => q, eq: () => q, in: () => q, is: () => q,
        maybeSingle: async () => ({ data, error: null }),
        then: (resolve: (value: { data: typeof data; error: null }) => unknown) => resolve({ data, error: null }),
      };
      return q;
    },
    rpc: async (_name: string, args: { p_variant_choice_id: string; p_cost_adjustment: number }) => {
      if (_name === 'set_option_hq_standard_cost') { if (state.productThrow) throw new Error('lost'); return { error: null }; }
      state.calls.push(args.p_variant_choice_id);
      if (args.p_variant_choice_id === state.throwAt) throw new Error('lost');
      if (args.p_variant_choice_id === 'b' && state.fail) return { error: { message: 'CONFLICT: retry' } };
      state.versions.set(args.p_variant_choice_id, args.p_cost_adjustment);
      return { error: null };
    },
  }),
}));
import { recordPublishedChoiceCosts, recordPublishedOptionCost, costRecordingNotice } from '@/lib/data/option-cost-recording';

describe('隔離モック: Version 部分失敗', () => {
  it('一件成功後の失敗を通知し、再試行で残りだけ記録', async () => {
    state.versions.clear(); state.calls = []; state.fail = true;
    const access = { available: true, canManage: true };
    const first = await recordPublishedChoiceCosts('p', 'publishChoice', undefined, access);
    expect(first.status).toBe('error');
    expect(costRecordingNotice(first)).toContain('商品は保存しました');
    expect([...state.versions.keys()]).toEqual(['a']);
    state.fail = false; state.calls = [];
    expect((await recordPublishedChoiceCosts('p', 'publishChoice', undefined, access)).status).toBe('recorded');
    expect(state.calls).toEqual(['b']);
    expect([...state.versions.keys()]).toEqual(['a', 'b']);
  });
});

describe('権限と利用可否', () => {
  it('権限なし・機能未提供はRPCを呼ばずスキップする', async () => {
    state.calls = [];
    expect(await recordPublishedChoiceCosts('p', 'choice', undefined, { available: true, canManage: false })).toEqual({ status: 'skipped' });
    expect(await recordPublishedChoiceCosts('p', 'choice', undefined, { available: false, canManage: false })).toEqual({ status: 'unavailable' });
    expect(state.calls).toEqual([]);
  });
  it('権限確認エラーは記録せずエラーを返す', async () => {
    state.calls = [];
    expect((await recordPublishedChoiceCosts('p', 'choice', undefined, { available: true, canManage: false, error: true })).status).toBe('error');
    expect(state.calls).toEqual([]);
  });
});


describe('結果不明時の価格キャッシュ', () => {
  it.each(['a', 'b'])('選択肢 %s の応答消失後もキャッシュを失効する', async (id) => {
    state.versions.clear(); state.calls = []; state.fail = false; state.throwAt = id; state.refresh.mockClear();
    await expect(recordPublishedChoiceCosts('p', 'publishChoice', undefined, { available: true, canManage: true })).rejects.toThrow('lost');
    expect(state.refresh).toHaveBeenCalledTimes(id === 'a' ? 1 : 2);
    state.throwAt = '';
  });
  it('商品原価RPCの応答消失後もキャッシュを失効する', async () => {
    state.productThrow = true; state.refresh.mockClear();
    await expect(recordPublishedOptionCost('p', 'save', { available: true, canManage: true })).rejects.toThrow('lost');
    expect(state.refresh).toHaveBeenCalledOnce(); state.productThrow = false;
  });
});

it('キャッシュ失効自体が失敗した場合は成功と扱わず後続RPCを行わない', async () => {
  state.versions.clear(); state.calls = []; state.fail = false; state.throwAt = '';
  state.refresh.mockClear(); state.refresh.mockImplementationOnce(() => { throw new Error('cache'); });
  await expect(recordPublishedChoiceCosts('p', 'publishChoice', undefined, { available: true, canManage: true })).rejects.toThrow('cache');
  expect(state.calls).toEqual(['a']);
});
