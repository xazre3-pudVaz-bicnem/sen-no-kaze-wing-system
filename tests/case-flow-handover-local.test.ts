import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalCaseFlowStore } from '@/lib/data/case-flow/local';
import { loadDb, saveDb } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';
import {
  canSetPunchItemStatus,
  canUpdateAfterService,
  normalizeCertificateSignedOn,
  normalizeDisasterConsentInput,
  normalizeHandedOverOn,
  normalizeHandoverInspectionInput,
  normalizeHandoverIssues,
  normalizeStockLedgerEntryInput,
} from '@/lib/domain/case-flow';
import type { ElectronicContract, Profile, Quote, QuoteItem, QuoteRequest, RoleCode } from '@/lib/domain/types';

/** フェーズ14〜15（完了確認・是正・引渡し・アフター・災害時提供の意思・全国ストック台帳）。DB（20261013237000）と同じ判定になっているか */

const ids = {
  admin: '00000000-0000-4000-8000-0000000003a1',
  dealer: '00000000-0000-4000-8000-0000000003d1',
  dealerB: '00000000-0000-4000-8000-0000000003d2',
  master: '00000000-0000-4000-8000-0000000003e1',
  customer: '00000000-0000-4000-8000-0000000003c1',
  request: '00000000-0000-4000-8000-0000000003f1',
  quote: '00000000-0000-4000-8000-0000000003f2',
  contract: '00000000-0000-4000-8000-0000000003f3',
};
const user = (id: string, role: RoleCode, name: string): SessionUser => ({ id, email: `${name}@example.invalid`, role, full_name: name });
const admin = user(ids.admin, 'admin', '本部');
const dealer = user(ids.dealer, 'dealer', '担当代理店');
const dealerB = user(ids.dealerB, 'dealer', '他の代理店');
const master = user(ids.master, 'master_dealer', '総代理店');
const customer = user(ids.customer, 'customer', 'お客様');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
const inspection = { inspection_on: today, inspection_summary: '外装・設備の動作を確認しました' };
const ledgerInput = (status: 'registered' | 'suspended') =>
  normalizeStockLedgerEntryInput({ registration_status: status, operating_status: '住居として使用中', immediate_available: true, supply_72h: true, location_prefecture: '石川県' }, today);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function seed(signed = true) {
  const db = loadDb();
  const now = new Date().toISOString();
  for (const u of [admin, dealer, dealerB, master, customer]) {
    db.profiles.push({ id: u.id, customer_no: null, email: u.email, full_name: u.full_name, company_name: null, phone: null, postal_code: null, address: null, role_code: u.role, created_at: now, updated_at: now } as Profile);
  }
  db.quoteRequests.push({ id: ids.request, configuration_id: null, user_id: ids.customer, quote_id: ids.quote, status: 'sent', message: null, contact: { full_name: 'お客様', company_name: null, email: customer.email, phone: '0', address: 'x', site_address: null }, created_at: now, updated_at: now } as QuoteRequest);
  db.quotes.push({ id: ids.quote, quote_no: 'Q-HO', quote_request_id: ids.request, user_id: ids.customer, dealer_id: ids.dealer, customer_name: 'お客様', revision: 2, status: 'accepted', base_model_name: 'Wing', total: 5000000 } as unknown as Quote);
  db.quoteItems.push({ id: 'qi-1', quote_id: ids.quote, kind: 'base', name: '本体一式', unit_price: 3000000, quantity: 1, amount: 3000000, sort_order: 0 } as unknown as QuoteItem);
  if (signed) {
    db.contracts.push({ id: ids.contract, quote_request_id: ids.request, quote_id: ids.quote, user_id: ids.customer, provider: 'paper', status: 'signed', signer_name: 'お客様', signer_email: customer.email, contract_total: 5000000, envelope_xid: null, provider_document_id: null, signed_file_path: 'contracts/paper/x.pdf', failure_reason: null, sent_at: null, signed_at: now, canceled_at: null, created_at: now, updated_at: now } as ElectronicContract);
  }
  saveDb(db);
}

/** 製造依頼を送り、1 棟を設置済みにする（引渡し完了で引渡し済みになるか確かめるため） */
async function installOneUnit(store: LocalCaseFlowStore) {
  const orderId = await store.createManufacturingOrder(dealer, ids.request, { unit_count: 1, requested_delivery_on: null, spec_note: null, supply_note: null });
  await store.setCaseManufacturer(admin, ids.request, ids.master);
  await store.sendManufacturingOrder(dealer, orderId, 1);
  const [unit] = await store.listManufacturingUnits(dealer, orderId);
  const input = (status: 'shipped' | 'installed') => ({ status, produced_on: null, inspected_on: null, shipped_on: null, installed_on: null, handed_over_on: null, note: null });
  await store.updateManufacturingUnit(master, unit.id, input('shipped'), 1);
  await store.updateManufacturingUnit(dealer, unit.id, input('installed'), 2);
  return { orderId, unitId: unit.id };
}

/** 完成確認 → お客様の「問題なし」 → 承諾書の記録 → 引渡し完了 */
async function handOver(store: LocalCaseFlowStore) {
  const v1 = await store.startHandoverInspection(dealer, ids.request, inspection, null);
  const v2 = await store.confirmHandover(customer, ids.request, 'ok', [], v1);
  const file = await store.uploadCaseFile(dealer, ids.request, { context: 'handover', context_id: null, file_name: '承諾書.pdf', content_type: 'application/pdf', size_bytes: pdf.byteLength, caption: '工事完了承諾書', customer_visible: true }, pdf);
  const v3 = await store.recordCompletionCertificate(dealer, ids.request, file.id, today, v2);
  await store.completeHandover(dealer, ids.request, today, v3);
  return file;
}

describe('完了確認・是正・引渡し・アフター・災害時提供（ローカル検証モード）', () => {
  let dir = '';
  let store: LocalCaseFlowStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-case-ho-'));
    process.env.WING_LOCAL_DIR = dir;
    store = new LocalCaseFlowStore();
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('完成確認は契約の後に担当代理店か本部が始める。お客様の指摘は是正事項になり、是正と確認が済むまで「問題なし」にできない', async () => {
    seed(false);
    await expect(store.startHandoverInspection(dealer, ids.request, inspection, null)).rejects.toMatchObject({ code: 'LOCKED' });
    const db = loadDb();
    db.contracts.push({ id: ids.contract, quote_request_id: ids.request, quote_id: ids.quote, user_id: ids.customer, provider: 'paper', status: 'signed', signer_name: 'お客様', signer_email: customer.email, contract_total: 1, envelope_xid: null, provider_document_id: null, signed_file_path: 'x.pdf', failure_reason: null, sent_at: null, signed_at: new Date().toISOString(), canceled_at: null, created_at: '', updated_at: '' } as ElectronicContract);
    saveDb(db);
    await expect(store.startHandoverInspection(customer, ids.request, inspection, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.startHandoverInspection(dealerB, ids.request, inspection, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.startHandoverInspection(dealer, ids.request, inspection, null)).toBe(1);
    expect(loadDb().notifications.some((n) => n.kind === 'handover_inspection' && n.recipient_id === ids.customer)).toBe(true);

    await expect(store.confirmHandover(dealer, ids.request, 'ok', [], 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.confirmHandover(customer, ids.request, 'ok', [], 9)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await store.confirmHandover(customer, ids.request, 'issues', ['玄関ドアの閉まりが固い', '外壁のキズ'], 1)).toBe(2);
    const items = await store.listPunchItems(customer, ids.request);
    expect(items.map((i) => [i.status, i.raised_by_customer])).toEqual([
      ['open', true],
      ['open', true],
    ]);
    expect((await store.getHandover(dealer, ids.request))?.status).toBe('correcting');
    await expect(store.confirmHandover(customer, ids.request, 'ok', [], 2)).rejects.toMatchObject({ code: 'LOCKED' });

    // 是正は担当、是正の確認はお客様（または担当）。総代理店はどちらもできない
    await expect(store.setPunchItemStatus(customer, items[0].id, 'fixed', 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.setPunchItemStatus(dealer, items[0].id, 'verified', 1)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await store.setPunchItemStatus(dealer, items[0].id, 'fixed', 1)).toBe(2);
    expect(loadDb().notifications.some((n) => n.kind === 'punch_item_fixed' && n.recipient_id === ids.customer)).toBe(true);
    await store.setCaseManufacturer(admin, ids.request, ids.master);
    await expect(store.setPunchItemStatus(master, items[0].id, 'verified', 2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.setPunchItemStatus(customer, items[0].id, 'verified', 2)).toBe(3);
    await store.setPunchItemStatus(dealer, items[1].id, 'fixed', 1);
    await store.setPunchItemStatus(dealer, items[1].id, 'verified', 2);
    expect(await store.confirmHandover(customer, ids.request, 'ok', [], 2)).toBe(3);
    expect(await store.getHandover(customer, ids.request)).toMatchObject({ status: 'ready', customer_confirmation: 'ok', customer_confirmed_via: 'mypage' });
  });

  it('承諾書の写しを記録してから引渡し完了。設置済みの個体は引渡し済みになり、承諾書の写しは消せない', async () => {
    seed();
    const { orderId } = await installOneUnit(store);
    const v1 = await store.startHandoverInspection(dealer, ids.request, inspection, null);
    const v2 = await store.confirmHandover(customer, ids.request, 'ok', [], v1);
    await expect(store.completeHandover(dealer, ids.request, today, v2)).rejects.toMatchObject({ code: 'LOCKED' });
    const doc = await store.uploadCaseFile(customer, ids.request, { context: 'document', context_id: null, file_name: 'x.pdf', content_type: 'application/pdf', size_bytes: pdf.byteLength, caption: null, customer_visible: true }, pdf);
    await expect(store.recordCompletionCertificate(dealer, ids.request, doc.id, today, v2)).rejects.toMatchObject({ code: 'VALIDATION' });
    const cert = await store.uploadCaseFile(dealer, ids.request, { context: 'handover', context_id: null, file_name: '承諾書.pdf', content_type: 'application/pdf', size_bytes: pdf.byteLength, caption: null, customer_visible: true }, pdf);
    await expect(store.recordCompletionCertificate(customer, ids.request, cert.id, today, v2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const v3 = await store.recordCompletionCertificate(dealer, ids.request, cert.id, today, v2);
    await expect(store.deleteCaseFile(admin, cert.id)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(store.completeHandover(dealer, ids.request, '2000-01-01', v3)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await store.completeHandover(dealer, ids.request, today, v3)).toBe(v3 + 1);
    expect((await store.listManufacturingUnits(dealer, orderId)).map((u) => [u.status, u.handed_over_on])).toEqual([['handed_over', today]]);
    expect(loadDb().notifications.some((n) => n.kind === 'handover_completed' && n.recipient_id === ids.customer)).toBe(true);
    // 引渡しの後は、是正事項・完成確認のやり直し・回答はできない（不具合はアフターで受ける）
    await expect(store.addPunchItem(dealer, ids.request, '追加の是正', v3 + 1)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(store.startHandoverInspection(dealer, ids.request, inspection, v3 + 1)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(store.confirmHandover(customer, ids.request, 'issues', ['x'], v3 + 1)).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('マイページを使わないお客様は、署名済みの承諾書の記録をお客様の確認として扱う。後から是正事項を足すと、確認と承諾書は記録し直し', async () => {
    seed();
    const v1 = await store.startHandoverInspection(admin, ids.request, inspection, null);
    const cert = await store.uploadCaseFile(admin, ids.request, { context: 'handover', context_id: null, file_name: 'c.pdf', content_type: 'application/pdf', size_bytes: pdf.byteLength, caption: null, customer_visible: false }, pdf);
    const v2 = await store.recordCompletionCertificate(admin, ids.request, cert.id, today, v1);
    expect(await store.getHandover(admin, ids.request)).toMatchObject({ status: 'ready', customer_confirmation: 'ok', customer_confirmed_via: 'certificate', certificate_file_id: cert.id });
    await expect(store.addPunchItem(customer, ids.request, '傷', v2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const v3 = await store.addPunchItem(dealer, ids.request, '雨どいの調整', v2).then(async () => (await store.getHandover(dealer, ids.request))!.lock_version);
    expect(await store.getHandover(dealer, ids.request)).toMatchObject({ status: 'correcting', customer_confirmation: 'pending', certificate_file_id: null });
    await expect(store.recordCompletionCertificate(dealer, ids.request, cert.id, today, v3)).rejects.toMatchObject({ code: 'LOCKED' });
    // 承諾書から外れた写しは、登録した人（本部）が消せる
    await store.deleteCaseFile(admin, cert.id);
  });

  it('アフター：引渡しの後にお客様・担当が登録する。製造起因は総代理店へ回し、総代理店は回されたものだけ見て回答・完了できる', async () => {
    seed();
    const req = { kind: 'repair' as const, title: '窓の鍵がかかりにくい', body: '先週から' };
    await expect(store.createAfterServiceRequest(customer, ids.request, req)).rejects.toMatchObject({ code: 'LOCKED' });
    await handOver(store);
    await expect(store.createAfterServiceRequest(dealerB, ids.request, req)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const id = await store.createAfterServiceRequest(customer, ids.request, req);
    const notes = loadDb().notifications.filter((n) => n.kind === 'after_service_requested');
    expect(notes.map((n) => n.recipient_id).sort()).toEqual([ids.dealer, null].sort());
    await expect(store.updateAfterServiceRequest(customer, id, { status: 'resolved' }, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // 製造の担当が決まるまで回せない。総代理店には回す前は見えない
    await expect(store.updateAfterServiceRequest(dealer, id, { status: 'escalated' }, 1)).rejects.toMatchObject({ code: 'LOCKED' });
    await store.setCaseManufacturer(admin, ids.request, ids.master);
    expect(await store.listAfterServiceRequests(master, ids.request)).toEqual([]);
    expect(await store.listAfterServiceBoard(master)).toEqual([]);
    await expect(store.updateAfterServiceRequest(master, id, { status: 'resolved' }, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await store.updateAfterServiceRequest(dealer, id, { status: 'escalated', response: '製造元で確認します' }, 1)).toBe(2);
    expect(loadDb().notifications.some((n) => n.kind === 'after_service_escalated' && n.recipient_id === ids.master)).toBe(true);
    expect((await store.listAfterServiceBoard(master)).map((r) => [r.id, r.viewer_access])).toEqual([[id, 'manufacturer']]);
    await expect(store.updateAfterServiceRequest(master, id, { status: 'in_progress' }, 2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.updateAfterServiceRequest(master, id, { status: 'resolved', response: '部品を交換しました' }, 2)).toBe(3);
    expect(loadDb().notifications.some((n) => n.kind === 'after_service_resolved' && n.recipient_id === ids.customer)).toBe(true);
    expect((await store.listAfterServiceRequests(customer, ids.request))[0]).toMatchObject({ status: 'resolved', response: '部品を交換しました' });
    await expect(store.updateAfterServiceRequest(dealer, id, { status: 'open' }, 3)).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('災害時提供：本部が文面を登録するまで・引渡しの前は設定できない。不承諾にしたら台帳の登録を止める', async () => {
    seed();
    const { unitId } = await installOneUnit(store);
    // 文面が無い間は設定できない
    await expect(store.setDisasterConsent(customer, ids.request, { decision: 'accepted', conditions: null, text_version: 1 })).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(store.publishDisasterConsentText(dealer, { title: '承諾書', body: '本文' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.publishDisasterConsentText(admin, { title: '承諾書', body: '（先方の文面）' })).toBe(1);
    expect(loadDb().auditLogs.some((a) => a.entity === 'disaster_consent_texts')).toBe(true);
    await expect(store.setDisasterConsent(customer, ids.request, { decision: 'accepted', conditions: null, text_version: 1 })).rejects.toMatchObject({ code: 'LOCKED' });
    // 台帳は引渡し済みの個体だけ
    await expect(store.saveStockLedgerEntry(admin, unitId, ledgerInput('suspended'), null)).rejects.toMatchObject({ code: 'LOCKED' });
    await handOver(store);

    await expect(store.setDisasterConsent(dealer, ids.request, { decision: 'accepted', conditions: null, text_version: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.saveStockLedgerEntry(admin, unitId, ledgerInput('registered'), null)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(store.saveStockLedgerEntry(dealer, unitId, ledgerInput('suspended'), null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // 読んでいる間に新しい版が登録されたら、読み直してもらう
    await store.publishDisasterConsentText(admin, { title: '承諾書（第2版）', body: '（先方の文面・改訂）' });
    await expect(store.setDisasterConsent(customer, ids.request, { decision: 'accepted', conditions: null, text_version: 1 })).rejects.toMatchObject({ code: 'LOCKED' });
    await store.setDisasterConsent(customer, ids.request, { decision: 'conditional', conditions: '連絡がついてから', text_version: 2 });
    expect(await store.saveStockLedgerEntry(admin, unitId, ledgerInput('registered'), null)).toBe(1);
    await expect(store.saveStockLedgerEntry(admin, unitId, ledgerInput('registered'), null)).rejects.toMatchObject({ code: 'LOCKED' });
    const [row] = await store.listStockLedger(admin);
    expect(row).toMatchObject({ entry: { registration_status: 'registered', supply_72h: true }, latest_consent: { decision: 'conditional', conditions: '連絡がついてから' } });

    await store.setDisasterConsent(customer, ids.request, { decision: 'declined', conditions: '無視される', text_version: 2 });
    const [after] = await store.listStockLedger(admin);
    expect(after.entry?.registration_status).toBe('suspended');
    expect(after.latest_consent).toMatchObject({ decision: 'declined', conditions: null });
    await expect(store.saveStockLedgerEntry(admin, unitId, ledgerInput('registered'), after.entry!.lock_version)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await store.saveStockLedgerEntry(admin, unitId, ledgerInput('suspended'), after.entry!.lock_version)).toBe(after.entry!.lock_version + 1);
    // 履歴は残り、総代理店と他の代理店には見えない。台帳は本部だけ
    expect((await store.listDisasterConsents(customer, ids.request)).map((c) => c.decision)).toEqual(['declined', 'conditional']);
    expect(await store.listDisasterConsents(master, ids.request)).toEqual([]);
    expect(await store.listDisasterConsents(dealerB, ids.request)).toEqual([]);
    expect(await store.listStockLedger(dealer)).toEqual([]);
  });

  it('入力の検査と、状態の変更の規則', () => {
    expect(normalizeHandoverIssues('ドアが固い\n\n  外壁のキズ  ')).toEqual(['ドアが固い', '外壁のキズ']);
    expect(() => normalizeHandoverIssues('  \n ')).toThrow('1〜20 件');
    expect(() => normalizeHandoverIssues(Array.from({ length: 21 }, (_, i) => `点 ${i}`).join('\n'))).toThrow('1〜20 件');
    expect(() => normalizeHandoverInspectionInput({ inspection_on: '2026-10-13' }, '2026-10-13')).not.toThrow();
    expect(() => normalizeHandoverInspectionInput({ inspection_on: '2028-01-01' }, '2026-10-13')).toThrow('完成確認の日');
    expect(() => normalizeCertificateSignedOn('2026-10-14', '2026-10-13', '2026-10-01')).toThrow('署名日');
    expect(normalizeCertificateSignedOn('2026-10-13', '2026-10-13', '2026-10-01')).toBe('2026-10-13');
    expect(() => normalizeHandedOverOn('2026-09-30', '2026-10-13', '2026-10-01')).toThrow('引渡し日');
    expect(() => normalizeDisasterConsentInput({ decision: 'conditional', conditions: ' ', text_version: '1' })).toThrow('条件');
    expect(normalizeDisasterConsentInput({ decision: 'accepted', conditions: '不要', text_version: '2' })).toEqual({ decision: 'accepted', conditions: null, text_version: 2 });
    expect(() => normalizeDisasterConsentInput({ decision: 'maybe', text_version: 1 })).toThrow();
    expect(canSetPunchItemStatus('staff', 'open', 'fixed')).toBe(true);
    expect(canSetPunchItemStatus('customer', 'open', 'fixed')).toBe(false);
    expect(canSetPunchItemStatus('customer', 'fixed', 'verified')).toBe(true);
    expect(canSetPunchItemStatus('manufacturer', 'fixed', 'verified')).toBe(false);
    expect(canUpdateAfterService('manufacturer', { status: 'open', escalated_at: null }, 'resolved')).toBe(false);
    expect(canUpdateAfterService('manufacturer', { status: 'escalated', escalated_at: 'x' }, 'resolved')).toBe(true);
    expect(canUpdateAfterService('staff', { status: 'resolved', escalated_at: null }, 'open')).toBe(false);
  });
});

describe('フェーズ14〜15 の DB（20261013237000）', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261013237000_case_flow_handover_after_disaster.sql'), 'utf8').split('\r').join('');
  const policyOf = (table: string) => {
    const start = migration.indexOf(`create policy ${table}_read`);
    return migration.slice(start, migration.indexOf(';', start));
  };

  it('総代理店は回されたアフターだけ読める。災害時提供の意思は総代理店に見せず、台帳は本部だけ', () => {
    expect(policyOf('after_service_requests')).toContain("escalated_at is not null and public.case_access(quote_request_id) = 'manufacturer'");
    expect(policyOf('disaster_consents')).toContain("in ('admin', 'staff', 'customer')");
    expect(policyOf('disaster_consents')).not.toContain("'manufacturer'");
    expect(policyOf('stock_ledger_entries')).toContain('current_role_rank(), 0) >= 3');
  });

  it('承諾書の文面は migration に書かない（本部が登録する）。意思は行を足して履歴を残す', () => {
    expect(migration).not.toMatch(/insert into public\.disaster_consent_texts\s*\(version, title, body, created_by\)\s*values\s*\(\s*1/);
    const setConsent = migration.slice(migration.indexOf('create function public.set_disaster_consent'), migration.indexOf('create function public.save_stock_ledger_entry'));
    expect(setConsent).toContain('insert into public.disaster_consents');
    expect(setConsent).not.toMatch(/update public\.disaster_consents|delete from public\.disaster_consents/);
    expect(setConsent).toContain("v_text.version is distinct from p_text_version");
  });

  it('引渡し完了には承諾書の記録が要り、記録した写しは消せない（delete_case_file は見えない資料を NOT_FOUND のまま）', () => {
    expect(migration).toContain('(status = \'handed_over\') = (handed_over_on is not null) and (status <> \'handed_over\' or certificate_file_id is not null)');
    const del = migration.slice(migration.indexOf('create or replace function public.delete_case_file'), migration.indexOf('$$;', migration.indexOf('create or replace function public.delete_case_file')));
    expect(del).toContain("(public.case_access(f.quote_request_id) = 'customer' and not f.customer_visible)");
    expect(del).toContain('工事完了承諾書として記録した写しは削除できません');
    expect(del.indexOf('NOT_FOUND')).toBeLessThan(del.indexOf('FORBIDDEN'));
  });

  it('画面からの操作は SECURITY DEFINER の RPC で、権限は状態の判定・書き込みより前に確認する', () => {
    for (const name of [
      'start_handover_inspection',
      'confirm_handover',
      'add_punch_item',
      'set_punch_item_status',
      'record_completion_certificate',
      'complete_handover',
      'create_after_service_request',
      'update_after_service_request',
      'publish_disaster_consent_text',
      'set_disaster_consent',
      'save_stock_ledger_entry',
    ]) {
      const start = migration.indexOf(`create function public.${name}(`);
      expect(start, name).toBeGreaterThan(0);
      const body = migration.slice(start, migration.indexOf('$$;', start));
      expect(body, name).toContain('security definer');
      expect(body, name).toContain("set search_path = ''");
      const firstAuth = Math.min(...['FORBIDDEN', 'NOT_FOUND'].map((w) => body.indexOf(w)).filter((i) => i > 0));
      const firstState = Math.min(...['LOCKED', 'insert into', 'update public.'].map((w) => body.indexOf(w)).filter((i) => i > 0));
      expect(firstAuth, name).toBeLessThan(firstState);
    }
  });
});
