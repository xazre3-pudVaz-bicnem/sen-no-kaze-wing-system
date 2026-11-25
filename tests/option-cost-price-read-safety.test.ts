import { afterEach, describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({ rows: [] as { id: string; price?: number; extra_price?: number; category_id?: string; group_id?: string }[] }));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({ from: () => ({ select: () => ({ in: async () => ({ data: stub.rows, error: null }) }) }) }),
}));
import { withLegacyChoicePrices, withLegacyOptionPrices } from '@/lib/data/legacy-prices';

describe('Version記録時の原価取得', () => {
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  afterEach(() => { if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; });
  it('匿名読取で行が欠落したとき0円を記録せず停止する', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    stub.rows = [{ id: 'a', extra_price: 0, group_id: 'g' }];
    await expect(withLegacyChoicePrices([{ id: 'a' }, { id: 'b' }], 'all', true)).rejects.toThrow('選択肢の金額を確認');
    stub.rows = [];
    await expect(withLegacyOptionPrices([{ id: 'a' }], 'all', true)).rejects.toThrow('商品価格を確認');
    expect((await withLegacyOptionPrices([{ id: 'a' }], 'all'))[0].price).toBe(0);
  });
  it('取得できた明示的な0円は許可する', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    stub.rows = [{ id: 'a', price: 0, category_id: 'c' }];
    expect((await withLegacyOptionPrices([{ id: 'a' }], 'all', true))[0].price).toBe(0);
    stub.rows = [{ id: 'a', extra_price: 0, group_id: 'g' }];
    expect((await withLegacyChoicePrices([{ id: 'a' }], 'all', true))[0].extra_price).toBe(0);
  });
});
