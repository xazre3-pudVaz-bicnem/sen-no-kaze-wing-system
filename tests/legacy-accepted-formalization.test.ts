import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Quote, QuoteRequest } from '@/lib/domain/types';
import {
  isCurrentAcceptedPreliminaryForFormalization,
  isFormalQuote,
  isQuoteAcceptanceEligible,
} from '@/lib/domain/quote-lifecycle';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261005090000_legacy_accepted_formal_compat.sql'),
  'utf8'
);
const entry = fs.readFileSync(path.join(root, 'components/admin/legacy-accepted-formalization-entry.tsx'), 'utf8');
const form = fs.readFileSync(path.join(root, 'components/admin/legacy-accepted-formalization-form.tsx'), 'utf8');
const action = fs.readFileSync(path.join(root, 'lib/actions/legacy-accepted-formalization.ts'), 'utf8');
const formalizePage = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/formalize/page.tsx'), 'utf8');
const stateRoute = fs.readFileSync(path.join(root, 'app/api/admin/quotes/[id]/formalization-state/route.ts'), 'utf8');
const estimateSheet = fs.readFileSync(path.join(root, 'components/admin/quote-estimate-sheet.tsx'), 'utf8');
const customerPage = fs.readFileSync(path.join(root, 'app/(site)/mypage/quotes/[id]/page.tsx'), 'utf8');

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    quote_no: 'Q-test-1',
    quote_request_id: '22222222-2222-4222-8222-222222222222',
    configuration_id: '33333333-3333-4333-8333-333333333333',
    user_id: '44444444-4444-4444-8444-444444444444',
    status: 'accepted',
    quote_kind: 'preliminary',
    base_model_id: '55555555-5555-4555-8555-555555555555',
    base_master_revision_id: null,
    spec_code: 'residence',
    issued_at: '2026-10-01T00:00:00.000Z',
    valid_until: '2026-10-31T00:00:00.000Z',
    customer_no: null,
    customer_name: 'テスト顧客',
    customer_company: null,
    base_model_name: 'Wing',
    finish_level: 'full',
    base_price: 1_000_000,
    base_expense: 150_000,
    option_subtotal: 0,
    option_expense: 0,
    installation_subtotal: 0,
    adjustment: 0,
    adjustment_reason: null,
    subtotal: 1_150_000,
    tax_rate: 0.1,
    tax: 115_000,
    total: 1_265_000,
    dealer_id: '66666666-6666-4666-8666-666666666666',
    dealer_note: null,
    revision: 1,
    parent_quote_id: null,
    preview_image_url: null,
    notes: null,
    created_by: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function request(currentQuoteId: string | null): QuoteRequest {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    configuration_id: '33333333-3333-4333-8333-333333333333',
    user_id: '44444444-4444-4444-8444-444444444444',
    quote_id: currentQuoteId,
    status: 'sent',
    case_name: null,
    message: null,
    contact: {
      full_name: 'テスト顧客',
      company_name: null,
      email: 'customer@example.test',
      phone: '',
      address: '',
      site_address: null,
    },
    created_by: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}

describe('legacy accepted preliminary formalization domain', () => {
  it('allows only current accepted explicit preliminary or legacy initial candidates', () => {
    const explicit = quote({ quote_kind: 'preliminary', parent_quote_id: null });
    expect(isCurrentAcceptedPreliminaryForFormalization(explicit, request(explicit.id))).toBe(true);

    const legacyInitial = quote({ quote_kind: null, parent_quote_id: null });
    expect(isCurrentAcceptedPreliminaryForFormalization(legacyInitial, request(legacyInitial.id))).toBe(true);

    const legacyFormal = quote({ quote_kind: null, parent_quote_id: '77777777-7777-4777-8777-777777777777' });
    expect(isFormalQuote(legacyFormal)).toBe(true);
    expect(isCurrentAcceptedPreliminaryForFormalization(legacyFormal, request(legacyFormal.id))).toBe(false);

    const explicitFormal = quote({ quote_kind: 'formal', parent_quote_id: null });
    expect(isCurrentAcceptedPreliminaryForFormalization(explicitFormal, request(explicitFormal.id))).toBe(false);

    expect(isCurrentAcceptedPreliminaryForFormalization(explicit, request('88888888-8888-4888-8888-888888888888'))).toBe(false);
    expect(isCurrentAcceptedPreliminaryForFormalization({ ...explicit, status: 'issued' }, request(explicit.id))).toBe(false);
  });

  it('keeps customer acceptance limited to current issued formal snapshots', () => {
    const preliminary = quote({ status: 'issued', quote_kind: 'preliminary' });
    const formal = quote({ status: 'issued', quote_kind: 'formal', parent_quote_id: preliminary.id });
    const legacyFormal = quote({
      id: '99999999-9999-4999-8999-999999999999',
      status: 'issued',
      quote_kind: null,
      parent_quote_id: preliminary.id,
    });

    expect(isQuoteAcceptanceEligible(preliminary, request(preliminary.id))).toBe(false);
    expect(isQuoteAcceptanceEligible(formal, request(formal.id))).toBe(true);
    expect(isQuoteAcceptanceEligible(legacyFormal, request(legacyFormal.id))).toBe(true);
  });
});

describe('legacy accepted preliminary compatibility migration', () => {
  const bridgeStart = migration.indexOf('create or replace function public.create_formal_quote_from_accepted_preliminary');
  const acceptanceStart = migration.indexOf('create or replace function public.respond_to_quote', bridgeStart);
  const bridge = migration.slice(bridgeStart, acceptanceStart);

  it('uses a dedicated compatibility RPC without changing the normal revision RPC', () => {
    expect(bridgeStart).toBeGreaterThanOrEqual(0);
    expect(migration).not.toContain('create or replace function public.create_quote_revision');
    expect(action).toContain("db.rpc('create_formal_quote_from_accepted_preliminary'");
    expect(action).not.toContain("db.rpc('create_quote_revision'");
  });

  it('locks parent Quote before QuoteRequest and rechecks current eligibility after the locks', () => {
    const quoteLock = bridge.indexOf('from public.quotes\n   where id = p_quote_id\n   for update;');
    const requestLock = bridge.indexOf('from public.quote_requests\n   where id = parent.quote_request_id\n   for update;');
    const currentCheck = bridge.indexOf('req.quote_id is distinct from parent.id');
    const insertQuote = bridge.indexOf('insert into public.quotes(');

    expect(quoteLock).toBeGreaterThanOrEqual(0);
    expect(requestLock).toBeGreaterThan(quoteLock);
    expect(currentCheck).toBeGreaterThan(requestLock);
    expect(insertQuote).toBeGreaterThan(currentCheck);
    expect(bridge).toContain("parent.status <> 'accepted'");
    expect(bridge).toContain("parent.quote_kind = 'preliminary'");
    expect(bridge).toContain('parent.quote_kind is null and parent.parent_quote_id is null');
  });

  it('validates Web identity and assigned staff access at the DB boundary', () => {
    expect(bridge).toContain('parent.configuration_id is null');
    expect(bridge).toContain('parent.user_id is null');
    expect(bridge).toContain('parent.dealer_id is null');
    expect(bridge).toContain('req.user_id is distinct from parent.user_id');
    expect(bridge).toContain('req.configuration_id is distinct from parent.configuration_id');
    expect(bridge).toContain('c.id = parent.configuration_id');
    expect(bridge).toContain('c.user_id = parent.user_id');
    expect(bridge).toContain('v_rank >= 3 or (v_rank >= 1 and parent.dealer_id = v_uid)');
  });

  it('keeps the accepted parent and closed Configuration untouched', () => {
    expect(bridge).not.toContain("set status = 'superseded'");
    expect(bridge).not.toContain('update public.configurations');
    expect(bridge).not.toContain('update public.quotes');
    expect(bridge).toContain('update public.quote_requests');
    expect(bridge).toContain('set quote_id = v_new');
  });

  it('creates a formal issued child in the same request/customer/configuration series', () => {
    expect(bridge).toContain("'issued', 'formal', parent.base_model_id, parent.base_master_revision_id, parent.spec_code");
    expect(bridge).toContain('parent.quote_request_id, parent.configuration_id, parent.user_id');
    expect(bridge).toContain('parent.revision + 1, parent.id');
    expect(bridge).toContain('parent.dealer_id');
    expect(bridge).toContain('parent.preview_image_url');
  });

  it('recomputes amounts, Web thousand-yen adjustment, tax, and total in the RPC', () => {
    expect(bridge).toContain('round(parent_item.unit_price::numeric * parent_item.quantity)');
    expect(bridge).toContain('round(v_unit_price_raw * v_qty)');
    expect(bridge).toContain('v_sub := floor(v_sub_raw / 1000.0) * 1000;');
    expect(bridge).toContain('v_adjustment := v_sub - v_sub_raw;');
    expect(bridge).toContain('v_tax := floor(v_sub * parent.tax_rate);');
    expect(bridge).toContain('v_total := v_sub + v_tax;');
  });

  it('preserves existing line identity without backfilling legacy NULL line_key', () => {
    expect(bridge).toContain('v_new, item.line_key, item.kind, item.option_id');
    expect(bridge).toContain('then source_item.line_key else gen_random_uuid() end');
    expect(bridge).toContain('source_item.option_id');
    expect(bridge).not.toContain('coalesce(item.line_key, gen_random_uuid())');
    expect(bridge).not.toMatch(/name\s*=\s*source_item\.name/i);
  });

  it('aligns customer acceptance to explicit formal or legacy NULL+parent formal only', () => {
    const acceptance = migration.slice(acceptanceStart);
    expect(acceptance).toContain("if p_status = 'accepted' and not (");
    expect(acceptance).toContain("q.quote_kind = 'formal'");
    expect(acceptance).toContain('q.quote_kind is null');
    expect(acceptance).toContain('q.parent_quote_id is not null');
    expect(acceptance).toContain('parent.quote_request_id = q.quote_request_id');
    expect(acceptance).toContain('parent.user_id = q.user_id');
    expect(acceptance).not.toContain("q.quote_kind = 'preliminary'");
    expect(customerPage).toContain('isQuoteAcceptanceEligible(quote, request)');
  });

  it('hardens SECURITY DEFINER owner and EXECUTE grants', () => {
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain('alter function public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text) owner to postgres;');
    expect(migration).toContain('alter function public.get_legacy_accepted_formalization_state(uuid) owner to postgres;');
    expect(migration).toContain('revoke execute on function public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)');
    expect(migration).toContain('from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text) to authenticated;');
    expect(bridge).toContain('v_uid uuid := auth.uid();');
  });

  it('does not alter the non-Web Draft lifecycle', () => {
    expect(migration).not.toContain('quote_drafts');
    expect(migration).not.toContain('save_quote_draft');
    expect(migration).not.toContain('finalize_quote_draft');
  });

  it('has the lock/pointer pattern needed for exactly-one-success concurrency, while leaving runtime concurrency verification to DB testing', () => {
    expect(bridge).toContain('for update;');
    expect(bridge).toContain('req.quote_id is distinct from parent.id');
    expect(bridge).toContain('update public.quote_requests');
    // This is intentionally a static contract test; it does not claim to execute concurrent transactions.
  });
});

describe('legacy accepted preliminary formalization UI', () => {
  it('shows the operation only after server-confirmed eligibility and labels historical parents', () => {
    expect(estimateSheet).toContain('<LegacyAcceptedFormalizationEntry quote={quote} />');
    expect(entry).toContain("result.state === 'ineligible' || result.state === 'unavailable'");
    expect(entry).toContain('概算見積は承諾済みです');
    expect(entry).toContain('施工金額を入力する');
    expect(entry).toContain('過去の概算承諾履歴');
    expect(entry).toContain('現在の確定見積を開く');
    expect(stateRoute).toContain("db.rpc('get_legacy_accepted_formalization_state'");
  });

  it('rechecks current preliminary eligibility on the formalization page and sends only installation rows', () => {
    expect(formalizePage).toContain('isCurrentAcceptedPreliminaryForFormalization(quote, request)');
    expect(formalizePage).toContain("item.kind === 'installation'");
    expect(form).toContain('source_item_id: item.id');
    expect(form).toContain('name="items_json"');
    expect(form).toContain('発行すると新しい確定見積になります');
  });
});
