import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quote, QuoteRequest } from '@/lib/domain/types';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { SupabaseStore } from '@/lib/data/supabase-store';

const quote = {
  id: 'quote',
  quote_request_id: 'request',
  configuration_id: 'configuration',
  user_id: 'customer',
  customer_name: '顧客',
  customer_company: null,
  created_at: '2026-09-27T00:00:00.000Z',
  updated_at: '2026-09-27T00:00:00.000Z',
  tax_rate: 0.1,
} as Quote;

const request = {
  id: 'request',
  quote_id: quote.id,
  configuration_id: quote.configuration_id,
  user_id: quote.user_id,
  status: 'sent',
  message: null,
  contact: { full_name: '顧客', company_name: null, email: '', phone: '', address: '', site_address: null },
  created_at: quote.created_at,
  updated_at: quote.updated_at,
} as QuoteRequest;

function query(result: { data: unknown; error: null }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: <TResult1 = { data: unknown; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return chain;
}

function configureDb(rpcResult: { data: unknown; error: { code?: string; message?: string } | null }) {
  const from = vi.fn((table: string) => {
    if (table === 'quotes') return query({ data: quote, error: null });
    if (table === 'quote_items') return query({ data: [], error: null });
    if (table === 'quote_requests') return query({ data: request, error: null });
    if (table === 'quote_documents' || table === 'profiles') return query({ data: null, error: null });
    throw new Error(`unexpected table ${table}`);
  });
  const rpc = vi.fn(() => Promise.resolve(rpcResult));
  mocks.createClient.mockResolvedValue({ from, rpc });
  return { from, rpc };
}

describe('SupabaseStore dealer current-quote compatibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps a dealer case detail available when the newly added RPC is not yet migrated', async () => {
    const { rpc } = configureDb({ data: null, error: { code: 'PGRST202' } });

    const detail = await new SupabaseStore().getQuote(quote.id, {
      id: 'dealer', email: 'dealer@example.test', role: 'dealer', full_name: '担当代理店',
    });

    expect(detail?.quote.id).toBe(quote.id);
    expect(detail?.items).toEqual([]);
    expect(detail?.request).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not use the dealer metadata RPC for customer, admin, or master dealer reads', async () => {
    for (const role of ['customer', 'admin', 'master_dealer'] as const) {
      const { rpc } = configureDb({ data: null, error: { code: 'PGRST202' } });

      const detail = await new SupabaseStore().getQuote(quote.id, {
        id: role, email: `${role}@example.test`, role, full_name: role,
      });

      expect(detail?.request).toEqual(request);
      expect(rpc).not.toHaveBeenCalled();
    }
  });
});
