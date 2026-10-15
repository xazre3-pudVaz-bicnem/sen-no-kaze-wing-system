import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({ createClient }));

import { SupabaseStore } from '@/lib/data/supabase-store';

const quote = {
  id: 'quote-1',
  user_id: 'customer-1',
  dealer_id: 'dealer-1',
  quote_no: 'Q-001',
  tax_rate: 0.1,
};

function setupStore(requestMetaResult: { data: unknown; error: { code?: string; message?: string } | null }) {
  const quoteResult = { data: [{ ...quote, profiles: { email: 'customer@example.com' } }], error: null };
  const order = vi.fn(async () => quoteResult);
  const eq = vi.fn(() => ({ order }));
  const inFilter = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq, in: inFilter }));
  const db = {
    from: vi.fn(() => ({ select })),
    rpc: vi.fn(async () => requestMetaResult),
  };
  createClient.mockResolvedValue(db);
  return { db, eq, inFilter, store: new SupabaseStore() };
}

describe('SupabaseStore.listDealerQuotes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges the minimum request metadata returned by the RPC without getQuote calls', async () => {
    const { db, eq, inFilter, store } = setupStore({
      data: [{ quote_id: 'quote-1', request_status: 'new', site_address: '石川県七尾市' }],
      error: null,
    });
    const getQuote = vi.spyOn(store, 'getQuote');

    await expect(store.listDealerQuotes('dealer-1')).resolves.toMatchObject([
      { id: 'quote-1', request_status: 'new', site_address: '石川県七尾市' },
    ]);
    expect(db.rpc).toHaveBeenCalledWith('list_dealer_quote_request_meta');
    expect(db.from).toHaveBeenCalledTimes(1);
    // 一覧に出す見積は RPC が決める（主担当者の案件と、営業担当組織の管理者なら自社の全案件。20261015130000）
    expect(inFilter).toHaveBeenCalledWith('id', ['quote-1']);
    expect(eq).not.toHaveBeenCalled();
    expect(getQuote).not.toHaveBeenCalled();
  });

  it('keeps the quote list and returns null metadata when the migration RPC is missing', async () => {
    const { store, eq } = setupStore({ data: null, error: { code: 'PGRST202', message: 'function is not in the schema cache' } });

    await expect(store.listDealerQuotes('dealer-1')).resolves.toMatchObject([
      { id: 'quote-1', request_status: null, site_address: null },
    ]);
    // 関数が無い古い DB では、これまでどおり見積の担当で絞る
    expect(eq).toHaveBeenCalledWith('dealer_id', 'dealer-1');
  });

  it('does not hide non-compatibility RPC errors', async () => {
    const { store } = setupStore({ data: null, error: { code: '42501', message: 'permission denied' } });

    await expect(store.listDealerQuotes('dealer-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
