import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { loadDb, saveDb } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';
import { dealerQuoteRequestFromRpcResult } from '@/lib/data/supabase-store';
import type { Quote, QuoteRequest } from '@/lib/domain/types';
import { getAcceptedQuoteCaseState, isFormalQuote, isFormallyAcceptedQuote } from '@/lib/domain/quote-lifecycle';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260927051503_quote_acceptance_eligibility.sql'),
  'utf8'
);
const quotePage = fs.readFileSync(path.join(root, 'app/(site)/mypage/quotes/[id]/page.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');

const owner = { id: 'owner-quote-test', email: 'owner@example.test', role: 'customer' } as SessionUser;
const otherUser = { id: 'other-quote-test', email: 'other@example.test', role: 'customer' } as SessionUser;
const dealer = { id: 'dealer-quote-test', email: 'dealer@example.test', role: 'dealer', full_name: '担当代理店' } as SessionUser;
const requestId = 'request-quote-test';
const configurationId = 'configuration-quote-test';

function quote(id: string, status: Quote['status'], parentQuoteId: string | null, userId = owner.id): Quote {
  return {
    id,
    quote_no: `Q-test-${id}`,
    quote_request_id: requestId,
    configuration_id: configurationId,
    user_id: userId,
    status,
    issued_at: '2026-09-27T00:00:00.000Z',
    valid_until: '2026-10-27T00:00:00.000Z',
    customer_no: null,
    customer_name: '見積 テスト',
    customer_company: null,
    base_model_name: 'Wing',
    finish_level: 'full',
    base_price: 1_000_000,
    base_expense: 150_000,
    option_subtotal: 0,
    option_expense: 0,
    installation_subtotal: 200_000,
    adjustment: 0,
    subtotal: 1_350_000,
    tax_rate: 0.1,
    tax: 135_000,
    total: 1_485_000,
    dealer_id: null,
    dealer_note: null,
    revision: parentQuoteId ? 2 : 1,
    parent_quote_id: parentQuoteId,
    preview_image_url: null,
    notes: null,
    created_at: '2026-09-27T00:00:00.000Z',
    updated_at: '2026-09-27T00:00:00.000Z',
  };
}

function request(currentQuoteId: string, userId = owner.id): QuoteRequest {
  return {
    id: requestId,
    configuration_id: configurationId,
    user_id: userId,
    quote_id: currentQuoteId,
    status: 'sent',
    message: null,
    contact: { full_name: '見積 テスト', company_name: null, email: 'owner@example.test', phone: '', address: '', site_address: null },
    created_at: '2026-09-27T00:00:00.000Z',
    updated_at: '2026-09-27T00:00:00.000Z',
  };
}

function seed(quotes: Quote[], currentQuoteId: string, userId = owner.id) {
  const db = loadDb();
  db.quotes = quotes;
  db.quoteRequests = [request(currentQuoteId, userId)];
  saveDb(db);
}

describe('Quote acceptance eligibility', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-quote-acceptance-'));
    process.env.WING_LOCAL_DIR = dir;
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a preliminary quote even when it is the current issued quote', async () => {
    const preliminary = quote('preliminary', 'issued', null);
    preliminary.revision = 99; // eligibility must not be a revision-number check
    seed([preliminary], preliminary.id);

    await expect(new LocalStore().respondToQuote(preliminary.id, 'accepted', owner)).rejects.toThrow('確定見積');
    expect(loadDb().quotes[0].status).toBe('issued');
  });

  it('allows a customer to decline a current preliminary quote', async () => {
    const preliminary = quote('preliminary', 'issued', null);
    seed([preliminary], preliminary.id);

    const declined = await new LocalStore().respondToQuote(preliminary.id, 'declined', owner);

    expect(declined.status).toBe('declined');
  });

  it('accepts the current formal revision without changing its snapshot total', async () => {
    const initial = quote('initial', 'superseded', null);
    const formal = quote('formal', 'issued', initial.id);
    seed([initial, formal], formal.id);

    const accepted = await new LocalStore().respondToQuote(formal.id, 'accepted', owner);

    expect(accepted.status).toBe('accepted');
    expect(accepted.total).toBe(1_485_000);
    expect(loadDb().quotes.find((row) => row.id === initial.id)?.total).toBe(1_485_000);
  });

  it('rejects superseded and non-current revisions for either response', async () => {
    const initial = quote('initial', 'superseded', null);
    const superseded = quote('superseded', 'superseded', initial.id);
    seed([initial, superseded], superseded.id);
    await expect(new LocalStore().respondToQuote(superseded.id, 'accepted', owner)).rejects.toThrow('回答済み');

    const stale = quote('stale', 'issued', initial.id);
    const latest = quote('latest', 'issued', stale.id);
    seed([initial, stale, latest], latest.id);
    await expect(new LocalStore().respondToQuote(stale.id, 'accepted', owner)).rejects.toThrow('回答済み');
    await expect(new LocalStore().respondToQuote(stale.id, 'declined', owner)).rejects.toThrow('回答済み');
    expect(loadDb().quotes.find((row) => row.id === stale.id)?.status).toBe('issued');
  });

  it('does not create an invalid state when acceptance is repeated', async () => {
    const initial = quote('initial', 'superseded', null);
    const formal = quote('formal', 'issued', initial.id);
    seed([initial, formal], formal.id);
    const store = new LocalStore();

    await store.respondToQuote(formal.id, 'accepted', owner);
    await expect(store.respondToQuote(formal.id, 'accepted', owner)).rejects.toThrow('回答済み');
    expect(loadDb().quotes.filter((row) => row.status === 'accepted')).toHaveLength(1);
  });

  it('rejects a response from another customer', async () => {
    const initial = quote('initial', 'superseded', null);
    const formal = quote('formal', 'issued', initial.id);
    seed([initial, formal], formal.id);

    await expect(new LocalStore().respondToQuote(formal.id, 'accepted', otherUser)).rejects.toThrow('権限');
    expect(loadDb().quotes.find((row) => row.id === formal.id)?.status).toBe('issued');
  });

  it('lets the assigned dealer recognize a current formally accepted revision', async () => {
    const initial = quote('initial', 'superseded', null);
    const formal = quote('formal', 'accepted', initial.id);
    formal.dealer_id = dealer.id;
    seed([initial, formal], formal.id);

    const detail = await new LocalStore().getQuote(formal.id, dealer);

    expect(detail?.request?.quote_id).toBe(formal.id);
    expect(detail?.quote.status).toBe('accepted');
    expect(detail?.quote.parent_quote_id).toBe(initial.id);
    expect(detail && isFormallyAcceptedQuote(detail.quote, detail.request)).toBe(true);
  });

  it('keeps a dealer case detail available when only the new metadata RPC is missing', () => {
    const formal = quote('formal', 'accepted', 'initial');

    expect(dealerQuoteRequestFromRpcResult(formal, { data: null, error: { code: 'PGRST202' } })).toBeNull();
    expect(
      dealerQuoteRequestFromRpcResult(formal, {
        data: null,
        error: { message: 'Could not find the function public.get_dealer_quote_request_current in the schema cache' },
      })
    ).toBeNull();
  });

  it('does not hide dealer metadata authorization errors', () => {
    const formal = quote('formal', 'accepted', 'initial');

    expect(() => dealerQuoteRequestFromRpcResult(formal, { data: null, error: { code: '42501', message: 'permission denied' } })).toThrow('権限');
  });

  it('reconstructs only the viewed Quote as current and never exposes a stale current Quote ID', () => {
    const initial = quote('initial', 'superseded', null);
    const formal = quote('formal', 'accepted', initial.id);

    const currentRequest = dealerQuoteRequestFromRpcResult(formal, {
      data: [{ quote_request_id: requestId, is_current: true, request_status: 'sent', site_address: '東京都' }],
      error: null,
    });
    const staleRequest = dealerQuoteRequestFromRpcResult(initial, {
      data: [{ quote_request_id: requestId, is_current: false, request_status: 'sent', site_address: '東京都' }],
      error: null,
    });

    expect(currentRequest?.quote_id).toBe(formal.id);
    expect(isFormallyAcceptedQuote(formal, currentRequest)).toBe(true);
    expect(staleRequest?.quote_id).toBeNull();
  });

  it('uses lineage, not revision number, to distinguish preliminary and formal quotes', () => {
    const preliminary = quote('preliminary', 'issued', null);
    preliminary.revision = 99;
    const formal = quote('formal', 'issued', preliminary.id);
    formal.revision = 1;

    expect(isFormalQuote(preliminary)).toBe(false);
    expect(isFormalQuote(formal)).toBe(true);
  });

  it('separates preliminary and unconfirmed formal accepted history without advancing either to contract', () => {
    const preliminary = quote('preliminary', 'accepted', null);
    const initial = quote('initial', 'superseded', null);
    const formal = quote('formal', 'accepted', initial.id);

    expect(getAcceptedQuoteCaseState(preliminary, null)).toBe('preliminary');
    expect(getAcceptedQuoteCaseState(formal, null)).toBe('formal_unconfirmed');
    expect(getAcceptedQuoteCaseState(formal, request('other-current'))).toBe('formal_unconfirmed');
    expect(getAcceptedQuoteCaseState(formal, request(formal.id))).toBe('formal_current');
    expect(getAcceptedQuoteCaseState(quote('issued', 'issued', initial.id), null)).toBe('not_accepted');
  });
});

describe('Quote acceptance database and UI boundaries', () => {
  it('locks the quote and current QuoteRequest, then applies the formal condition only to acceptance', () => {
    const quoteLock = migration.indexOf('from public.quotes\n   where id = p_quote_id\n   for update;');
    const requestLock = migration.indexOf('from public.quote_requests\n   where id = q.quote_request_id\n     and user_id = q.user_id\n   for update;');
    const update = migration.indexOf('update public.quotes set status = p_status');

    expect(quoteLock).toBeGreaterThanOrEqual(0);
    expect(requestLock).toBeGreaterThan(quoteLock);
    expect(update).toBeGreaterThan(requestLock);
    expect(migration).toContain('q.user_id <> auth.uid()');
    expect(migration).toContain('q.parent_quote_id is null');
    expect(migration).toContain('parent.quote_request_id = q.quote_request_id');
    expect(migration).toContain('parent.user_id = q.user_id');
    expect(migration).toContain('v_current_quote_id is distinct from q.id');
    expect(migration).toContain("if p_status = 'accepted' and (");
  });

  it('prevents Data API status, lineage, and current-pointer writes from bypassing lifecycle RPCs', () => {
    expect(migration).toContain('current_user <> \'postgres\'');
    expect(migration).toContain('alter function public.create_quote_from_configuration(uuid, jsonb, text) owner to postgres;');
    expect(migration).toContain('alter function public.create_quote_revision(uuid, jsonb, text) owner to postgres;');
    expect(migration).toContain('alter function public.respond_to_quote(uuid, text) owner to postgres;');
    expect(migration).toContain('alter function public.assign_quote_dealer(uuid, uuid) owner to postgres;');
    expect(migration).toContain('create trigger trg_quotes_status_lifecycle');
    expect(migration).toContain('create trigger trg_quotes_lineage_lifecycle');
    expect(migration).toContain('create trigger trg_quote_requests_current_lifecycle');
    expect(migration).toContain('old.parent_quote_id is distinct from new.parent_quote_id');
    expect(migration).toContain('old.revision is distinct from new.revision');
    expect(migration).toContain('old.quote_request_id is distinct from new.quote_request_id');
    expect(migration).toContain('old.configuration_id is distinct from new.configuration_id');
    expect(migration).toContain('old.user_id is distinct from new.user_id');
    expect(migration).toContain('old.quote_id is distinct from new.quote_id');
    expect(migration).toContain('revoke execute on function public.respond_to_quote(uuid, text)');
    expect(migration).toContain('grant execute on function public.respond_to_quote(uuid, text) to authenticated;');
  });

  it('returns only current-pointer metadata to the assigned dealer without widening QuoteRequest RLS', () => {
    expect(migration).toContain('create or replace function public.get_dealer_quote_request_current(p_quote_id uuid)');
    expect(migration).toContain('where q.id = p_quote_id');
    expect(migration).toContain('q.dealer_id = (select auth.uid())');
    expect(migration).toContain('and (select public.is_dealer());');
    expect(migration).toContain("r.contact ->> 'site_address'");
    expect(migration).toContain('r.quote_id is not distinct from q.id');
    expect(migration).toContain('quote_request_id uuid,\n  is_current boolean,\n  request_status text,\n  site_address text');
    expect(migration).not.toContain("r.contact ->> 'address'");
    expect(migration).not.toContain('create policy quote_requests_dealer_select');
    expect(migration).toContain('alter function public.get_dealer_quote_request_current(uuid) owner to postgres;');
    expect(migration).toContain('revoke execute on function public.get_dealer_quote_request_current(uuid)');
    expect(migration).toContain('grant execute on function public.get_dealer_quote_request_current(uuid) to authenticated;');
    expect(supabaseStore).toContain("db.rpc('get_dealer_quote_request_current', { p_quote_id: id })");
    expect(supabaseStore).toContain('dealerQuoteRequestFromRpcResult(quote, {');
    expect(supabaseStore).toContain('if (isMissingFunction(result.error)) return null;');
    expect(supabaseStore).toContain("actor.role === 'dealer'");
  });

  it('pins assign_quote_dealer to the postgres-owned empty-search-path execution boundary', () => {
    expect(migration).toContain('create or replace function public.assign_quote_dealer(p_quote_id uuid, p_dealer_id uuid)');
    expect(migration).toContain("set search_path = ''\nas $$\ndeclare\n  q public.quotes;");
    expect(migration).toContain('if not public.is_admin() then');
    expect(migration).toContain('from public.profiles p');
    expect(migration).toContain('public.role_rank(p.role_code) >= 1');
    expect(migration).toContain('revoke execute on function public.assign_quote_dealer(uuid, uuid)\n  from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.assign_quote_dealer(uuid, uuid) to authenticated;');
  });

  it('keeps acceptance behind the formal-current predicate while retaining decline for a current estimate', () => {
    expect(quotePage).toContain('const canAccept = isQuoteAcceptanceEligible(quote, request);');
    expect(quotePage).toContain('const canDecline = isQuoteDeclineEligible(quote, request);');
    expect(quotePage).toContain('const acceptedQuoteCaseState = getAcceptedQuoteCaseState(quote, request);');
    expect(quotePage).toContain("const isFormallyAccepted = acceptedQuoteCaseState === 'formal_current';");
    expect(quotePage).toContain("const isFormalAcceptedUnconfirmed = acceptedQuoteCaseState === 'formal_unconfirmed';");
    expect(quotePage).toContain("const isPreliminaryAccepted = acceptedQuoteCaseState === 'preliminary';");
    expect(quotePage).toContain('{canAccept && (');
    expect(quotePage).toContain('{canDecline && (');
    expect(quotePage).toContain('この概算見積の承諾は過去の回答履歴です。');
    expect(quotePage).toContain('この確定見積は最新の見積であることを確認できません。');
    expect(quotePage).toContain('この見積で進めるご回答をいただきました。');
    expect(workspace).toContain('const acceptedQuoteCaseState = getAcceptedQuoteCaseState(quote, request);');
    expect(workspace).toContain("const isFormalAccepted = acceptedQuoteCaseState === 'formal_current';");
    expect(workspace).toContain("const isFormalAcceptedUnconfirmed = acceptedQuoteCaseState === 'formal_unconfirmed';");
    expect(workspace).toContain("const isPreliminaryAccepted = acceptedQuoteCaseState === 'preliminary';");
    expect(workspace).toContain("? '確定見積の承諾履歴'");
    expect(workspace).toContain("isPreliminaryAccepted ? '承諾履歴あり' : '発行済み'");
    expect(workspace).toContain('確定見積の承諾履歴（最新状態要確認）');
    expect(workspace).toContain('次にやること：最新の見積状態を確認');
    expect(workspace).toContain('概算見積の承諾履歴');
    expect(workspace).toContain('次にやること：担当代理店を決める');
    expect(workspace).toContain('次にやること：現地を確認して施工金額を入力');
    expect(workspace).not.toContain('<QuoteStatusForm');
  });
});
