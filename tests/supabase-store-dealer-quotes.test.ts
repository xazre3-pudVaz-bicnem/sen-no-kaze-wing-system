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
  const select = vi.fn(() => ({ eq }));
  const db = {
    from: vi.fn(() => ({ select })),
    rpc: vi.fn(async () => requestMetaResult),
  };
  createClient.mockResolvedValue(db);
  return { db, store: new SupabaseStore() };
}

describe('SupabaseStore.listDealerQuotes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges the minimum request metadata returned by the RPC without getQuote calls', async () => {
    const { db, store } = setupStore({
      data: [{ quote_id: 'quote-1', request_status: 'new', site_address: '石川県七尾市' }],
      error: null,
    });
    const getQuote = vi.spyOn(store, 'getQuote');

    await expect(store.listDealerQuotes('dealer-1')).resolves.toMatchObject([
      { id: 'quote-1', request_status: 'new', site_address: '石川県七尾市' },
    ]);
    expect(db.rpc).toHaveBeenCalledWith('list_dealer_quote_request_meta');
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(getQuote).not.toHaveBeenCalled();
  });

  it('keeps the quote list and returns null metadata when the migration RPC is missing', async () => {
    const { store } = setupStore({ data: null, error: { code: 'PGRST202', message: 'function is not in the schema cache' } });

    await expect(store.listDealerQuotes('dealer-1')).resolves.toMatchObject([
      { id: 'quote-1', request_status: null, site_address: null },
    ]);
  });

  it('does not hide non-compatibility RPC errors', async () => {
    const { store } = setupStore({ data: null, error: { code: '42501', message: 'permission denied' } });

    await expect(store.listDealerQuotes('dealer-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
