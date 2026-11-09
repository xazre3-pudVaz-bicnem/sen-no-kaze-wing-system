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
  issued_at: '2026-10-01T00:00:00+00:00',
};

type QuoteRow = Record<string, unknown> & { id: string };

function setupStore(
  requestMetaResult: { data: unknown; error: { code?: string; message?: string } | null },
  quotes: QuoteRow[] = [quote]
) {
  const withEmail: QuoteRow[] = quotes.map((q) => ({ ...q, profiles: { email: 'customer@example.com' } }));
  const order = vi.fn(async () => ({ data: withEmail, error: null }));
  const eq = vi.fn(() => ({ order }));
  const inFilter = vi.fn(async (_column: string, ids: string[]) => ({ data: withEmail.filter((q) => ids.includes(q.id)), error: null }));
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
    // 一覧に出す見積は RPC が決める（主担当者の案件と、営業担当組織の管理者なら自社の全案件。20261104130000）
    expect(inFilter).toHaveBeenCalledWith('id', ['quote-1']);
    expect(eq).not.toHaveBeenCalled();
    expect(getQuote).not.toHaveBeenCalled();
  });

  it('reads the quotes in chunks of 100 ids so the URL stays short, and keeps the newest-first order', async () => {
    const quotes = Array.from({ length: 250 }, (_, i) => ({
      ...quote,
      id: `quote-${String(i).padStart(3, '0')}`,
      // 発行前（NULL）は先、あとは発行日の新しい順
      issued_at: i === 7 ? null : `2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:${String(i % 60).padStart(2, '0')}+00:00`,
    }));
    const { db, inFilter, store } = setupStore(
      { data: quotes.map((q) => ({ quote_id: q.id, request_status: 'new', site_address: null })), error: null },
      quotes
    );

    const rows = await store.listDealerQuotes('dealer-1');
    expect(inFilter).toHaveBeenCalledTimes(3);
    for (const call of inFilter.mock.calls) expect((call[1] as string[]).length).toBeLessThanOrEqual(100);
    expect(db.from).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(250);
    expect(rows[0].id).toBe('quote-007');
    const issued = rows.slice(1).map((row) => row.issued_at as string);
    expect(issued).toEqual([...issued].sort((a, b) => b.localeCompare(a)));
  });

  it('does not query quotes when the RPC returns no case', async () => {
    const { db, inFilter, store } = setupStore({ data: [], error: null });

    await expect(store.listDealerQuotes('dealer-1')).resolves.toEqual([]);
    expect(inFilter).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
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
