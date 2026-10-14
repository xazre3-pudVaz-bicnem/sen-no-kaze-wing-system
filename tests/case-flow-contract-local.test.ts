import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalCaseFlowStore } from '@/lib/data/case-flow/local';
import { loadDb, saveDb, filesDir } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';
import { normalizePaperContractInput } from '@/lib/domain/case-flow';
import type { Profile, Quote, QuoteRequest, RoleCode } from '@/lib/domain/types';

/** フェーズ9（修正依頼）・10（書面の契約）。DB（20261013230000）と同じ判定になっているか */

const ids = {
  admin: '00000000-0000-4000-8000-0000000001a1',
  dealer: '00000000-0000-4000-8000-0000000001d1',
  customer: '00000000-0000-4000-8000-0000000001c1',
  other: '00000000-0000-4000-8000-0000000001c2',
  request: '00000000-0000-4000-8000-0000000001f1',
  quote: '00000000-0000-4000-8000-0000000001f2',
  oldQuote: '00000000-0000-4000-8000-0000000001f3',
};
const user = (id: string, role: RoleCode, name: string): SessionUser => ({ id, email: `${name}@example.invalid`, role, full_name: name });
const admin = user(ids.admin, 'admin', '本部');
const dealer = user(ids.dealer, 'dealer', '担当代理店');
const customer = user(ids.customer, 'customer', 'お客様');
const other = user(ids.other, 'customer', '他のお客様');
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function seed(status: 'issued' | 'accepted') {
  const db = loadDb();
  const now = new Date().toISOString();
  for (const u of [admin, dealer, customer, other]) {
    db.profiles.push({ id: u.id, customer_no: null, email: u.email, full_name: u.full_name, company_name: null, phone: null, postal_code: null, address: null, role_code: u.role, created_at: now, updated_at: now } as Profile);
  }
  db.quoteRequests.push({ id: ids.request, configuration_id: null, user_id: ids.customer, quote_id: ids.quote, status: 'sent', message: null, contact: { full_name: 'お客様', company_name: null, email: customer.email, phone: '0', address: 'x', site_address: null }, created_at: now, updated_at: now } as QuoteRequest);
  const quote = (id: string, revision: number, s: string) =>
    ({ id, quote_no: 'Q-CONTRACT', quote_request_id: ids.request, user_id: ids.customer, dealer_id: ids.dealer, customer_name: 'お客様', revision, status: s, total: 4950000 }) as unknown as Quote;
  db.quotes.push(quote(ids.oldQuote, 1, 'superseded'), quote(ids.quote, 2, status));
  saveDb(db);
}

describe('見積の修正依頼・書面の契約（ローカル検証モード）', () => {
  let dir = '';
  let store: LocalCaseFlowStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-case-contract-'));
    process.env.WING_LOCAL_DIR = dir;
    store = new LocalCaseFlowStore();
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('修正依頼：お客様本人だけが、発行済みの現在の見積に 1 件ずつ依頼でき、担当が対応済みにする', async () => {
    seed('issued');
    await expect(store.requestQuoteChange(other, ids.quote, 'エアコンを外したい')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.requestQuoteChange(dealer, ids.quote, 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.requestQuoteChange(customer, ids.oldQuote, 'x')).rejects.toMatchObject({ code: 'LOCKED' });
    const id = await store.requestQuoteChange(customer, ids.quote, 'エアコンを外したい');
    await expect(store.requestQuoteChange(customer, ids.quote, 'もう一件')).rejects.toMatchObject({ code: 'LOCKED' });
    expect(loadDb().notifications.some((n) => n.kind === 'quote_change_requested' && n.recipient_id === ids.dealer)).toBe(true);
    await expect(store.resolveQuoteChangeRequest(customer, id, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await store.resolveQuoteChangeRequest(dealer, id, '第 3 版を発行しました');
    const [row] = await store.listQuoteChangeRequests(customer, ids.request);
    expect(row).toMatchObject({ status: 'resolved', resolution: '第 3 版を発行しました' });
    expect(loadDb().notifications.some((n) => n.kind === 'quote_change_resolved' && n.recipient_id === ids.customer)).toBe(true);
    await expect(store.resolveQuoteChangeRequest(dealer, id, null)).rejects.toMatchObject({ code: 'LOCKED' });
    // 対応済みになれば、次の依頼を出せる
    await store.requestQuoteChange(customer, ids.quote, '色を変えたい');
  });

  it('書面の契約：本部だけが、承諾済みの現在の見積に記録でき、契約は同時に 1 つ。誤記録は無効にして記録し直せる', async () => {
    seed('accepted');
    const input = { signer_name: 'お客様', signer_email: customer.email, signed_on: '2026-10-10' };
    await expect(store.recordPaperContract(dealer, ids.quote, input, PDF)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.recordPaperContract(admin, ids.oldQuote, input, PDF)).rejects.toMatchObject({ code: 'LOCKED' });
    const id = await store.recordPaperContract(admin, ids.quote, input, PDF);
    const contract = loadDb().contracts.find((c) => c.id === id);
    expect(contract).toMatchObject({ provider: 'paper', status: 'signed', contract_total: 4950000, envelope_xid: null });
    expect(contract?.signed_file_path).toMatch(/^contracts\/paper\/[0-9a-f-]{36}\.pdf$/);
    expect(fs.readFileSync(path.join(filesDir(), contract!.signed_file_path!))).toEqual(Buffer.from(PDF));
    await expect(store.recordPaperContract(admin, ids.quote, input, PDF)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(store.voidPaperContract(dealer, id, '誤記録')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.voidPaperContract(admin, id, ' ')).rejects.toMatchObject({ code: 'VALIDATION' });
    await store.voidPaperContract(admin, id, '別の案件の契約書を登録したため');
    expect(loadDb().contracts.find((c) => c.id === id)).toMatchObject({ status: 'canceled', failure_reason: '別の案件の契約書を登録したため' });
    await expect(store.voidPaperContract(admin, id, 'x')).rejects.toMatchObject({ code: 'LOCKED' });
    await store.recordPaperContract(admin, ids.quote, input, PDF);
  });

  it('締結日は今日以前で、10 年以内', () => {
    expect(() => normalizePaperContractInput({ signer_name: 'a', signer_email: 'a@b.jp', signed_on: '2026-10-14' }, '2026-10-13')).toThrow('締結日');
    expect(() => normalizePaperContractInput({ signer_name: 'a', signer_email: 'a@b.jp', signed_on: '2016-10-12' }, '2026-10-13')).toThrow('締結日');
    expect(normalizePaperContractInput({ signer_name: ' a ', signer_email: 'A@B.JP', signed_on: '2026-10-13' }, '2026-10-13')).toEqual({
      signer_name: 'a',
      signer_email: 'a@b.jp',
      signed_on: '2026-10-13',
    });
  });
});

describe('フェーズ9〜10 の DB（20261013230000）', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261013230000_case_flow_change_request_paper_contract.sql'), 'utf8').split('\r').join('');

  it('修正依頼は見積の状態を変えず、別の表に記録する。お客様が依頼できるのは本人の現在の見積だけ', () => {
    const fn = migration.slice(migration.indexOf('create function public.request_quote_change'));
    expect(fn.indexOf("q.user_id is distinct from v_uid")).toBeLessThan(fn.indexOf('for update'));
    expect(fn).toContain("if req.quote_id is distinct from q.id then");
    expect(migration).not.toMatch(/update public\.quotes/);
    expect(migration).toContain('create unique index quote_change_requests_one_open_per_quote on public.quote_change_requests (quote_id) where status = \'open\';');
  });

  it('書面の契約は本部だけが記録・無効化でき、電子契約と同じ条件（承諾済みの現在の見積・同時に 1 つ）', () => {
    for (const name of ['record_paper_contract', 'void_paper_contract']) {
      const fn = migration.slice(migration.indexOf(`create function public.${name}`));
      expect(fn.indexOf('current_role_rank(), 0) < 3')).toBeLessThan(fn.indexOf('for update'));
    }
    const record = migration.slice(migration.indexOf('create function public.record_paper_contract'), migration.indexOf('create function public.void_paper_contract'));
    expect(record).toContain("if q.status <> 'accepted' then");
    expect(record).toContain("c.status in ('sending', 'sent', 'signed')");
    expect(record).toContain("v_path !~ '^contracts/paper/[0-9a-f-]{36}\\.pdf$'");
    expect(migration).toContain("add constraint contracts_provider_check check (provider in ('gmosign', 'paper'))");
    expect(migration).toContain("and (provider <> 'paper' or (status in ('signed', 'canceled') and envelope_xid is null))");
  });
});
