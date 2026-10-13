import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalCaseFlowStore } from '@/lib/data/case-flow/local';
import { loadDb, saveDb } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';
import type { Profile, Quote, QuoteRequest, RoleCode } from '@/lib/domain/types';

/**
 * ローカル検証モードの案件の進行。DB（20261013220000）の RPC・RLS と同じ判定になっているかを確かめる。
 * 実 DB の判定は scripts/db-rehearsal/runtime-security.sql の 19 で確かめる。
 */

const ids = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  dealerA: '00000000-0000-4000-8000-0000000000d1',
  dealerB: '00000000-0000-4000-8000-0000000000d2',
  master: '00000000-0000-4000-8000-0000000000e1',
  customer: '00000000-0000-4000-8000-0000000000c1',
  other: '00000000-0000-4000-8000-0000000000c2',
  request: '00000000-0000-4000-8000-0000000000f1',
  quote: '00000000-0000-4000-8000-0000000000f2',
};

const user = (id: string, role: RoleCode, name: string): SessionUser => ({ id, email: `${name}@example.invalid`, role, full_name: name });
const admin = user(ids.admin, 'admin', '本部');
const dealerA = user(ids.dealerA, 'dealer', '担当代理店');
const dealerB = user(ids.dealerB, 'dealer', '他の代理店');
const master = user(ids.master, 'master_dealer', '総代理店');
const customer = user(ids.customer, 'customer', 'お客様');
const other = user(ids.other, 'customer', '他のお客様');

const future = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

function seed() {
  const db = loadDb();
  const now = new Date().toISOString();
  const profile = (u: SessionUser): Profile => ({
    id: u.id,
    customer_no: null,
    email: u.email,
    full_name: u.full_name,
    company_name: null,
    phone: null,
    postal_code: null,
    address: null,
    role_code: u.role,
    created_at: now,
    updated_at: now,
  });
  db.profiles.push(...[admin, dealerA, dealerB, master, customer, other].map(profile));
  db.quoteRequests.push({
    id: ids.request,
    configuration_id: null,
    user_id: ids.customer,
    quote_id: ids.quote,
    status: 'new',
    message: null,
    contact: { full_name: 'お客様', company_name: null, email: customer.email, phone: '000', address: '住所', site_address: null },
    created_at: now,
    updated_at: now,
  } as QuoteRequest);
  db.quotes.push({ id: ids.quote, quote_no: 'Q-TEST-1', quote_request_id: ids.request, user_id: ids.customer, dealer_id: ids.dealerA, customer_name: 'お客様', revision: 1, status: 'issued' } as unknown as Quote);
  saveDb(db);
}

const notifications = () => loadDb().notifications;

describe('案件の進行（ローカル検証モード）', () => {
  let dir = '';
  let store: LocalCaseFlowStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-case-flow-'));
    process.env.WING_LOCAL_DIR = dir;
    seed();
    store = new LocalCaseFlowStore();
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('案件への関わり方：本部・担当代理店・お客様だけが見える。技術検討の担当は本部が指定したときだけ', async () => {
    expect(await store.getCaseAccess(admin, ids.request)).toBe('admin');
    expect(await store.getCaseAccess(dealerA, ids.request)).toBe('staff');
    expect(await store.getCaseAccess(customer, ids.request)).toBe('customer');
    expect(await store.getCaseAccess(dealerB, ids.request)).toBeNull();
    expect(await store.getCaseAccess(other, ids.request)).toBeNull();
    expect(await store.getCaseAccess(master, ids.request)).toBeNull();
    await expect(store.setCaseManufacturer(dealerA, ids.request, ids.master)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.setCaseManufacturer(admin, ids.request, ids.dealerB)).rejects.toMatchObject({ code: 'VALIDATION' });
    await store.setCaseManufacturer(admin, ids.request, ids.master);
    expect(await store.getCaseAccess(master, ids.request)).toBe('manufacturer');
  });

  it('代理店の紹介ページ：代理店は自分の分だけ編集でき、公開は本部だけ。お客様は公開中の代理店だけ選べる', async () => {
    const input = {
      display_name: '能登の工務店',
      intro: null,
      service_prefectures: ['石川県'],
      service_municipalities: [],
      services: ['foundation' as const],
      qualifications: null,
      track_record: null,
      completed_count: 3,
      phone: null,
      website_url: null,
    };
    await expect(store.saveDealerProfile(dealerA, ids.dealerB, input, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.saveDealerProfile(dealerA, ids.dealerA, input, null)).toBe(1);
    await expect(store.saveDealerProfile(dealerA, ids.dealerA, input, null)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(store.setDealerProfilePublished(dealerA, ids.dealerA, true, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const prefs = { preferred_dealer_id: ids.dealerA, meeting_method: 'onsite' as const, preferred_slots: [], note: null };
    await expect(store.setQuoteRequestPreferences(customer, ids.request, prefs)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await store.listPublishedDealerProfiles()).toEqual([]);
    expect(await store.setDealerProfilePublished(admin, ids.dealerA, true, 1)).toBe(2);
    expect((await store.listPublishedDealerProfiles()).map((p) => p.dealer_id)).toEqual([ids.dealerA]);
    await expect(store.setQuoteRequestPreferences(other, ids.request, prefs)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await store.setQuoteRequestPreferences(customer, ids.request, prefs);
    expect((await store.getQuoteRequestPreferences(dealerA, ids.request))?.preferred_dealer_id).toBe(ids.dealerA);
    expect(notifications().some((n) => n.kind === 'case_preferred_dealer' && n.recipient_id === null)).toBe(true);
  });

  it('受付：担当代理店が受付すると、お客様へ知らせる。主担当者は本部か担当代理店だけ', async () => {
    await expect(store.acknowledgeCase(customer, ids.request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await store.acknowledgeCase(dealerA, ids.request);
    expect((await store.getCaseProgress(customer, ids.request))?.acknowledged_at).toBeTruthy();
    expect(notifications().some((n) => n.kind === 'case_acknowledged' && n.recipient_id === ids.customer)).toBe(true);
    // お客様は社内の担当の設定（case_workflows）を読めない
    expect(await store.getCaseWorkflow(customer, ids.request)).toBeNull();
    await expect(store.assignCasePrimaryStaff(admin, ids.request, ids.dealerB)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.assignCasePrimaryStaff(dealerA, ids.request, ids.admin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await store.assignCasePrimaryStaff(dealerA, ids.request, ids.dealerA);
    expect((await store.getCaseProgress(customer, ids.request))?.primary_staff_name).toBe('担当代理店');
  });

  it('日程：担当が候補を送り、お客様が選ぶ。版が古いと拒否し、担当でない人には見せない', async () => {
    const proposal = { purpose: 'meeting' as const, method: 'onsite' as const, candidates: [{ starts_at: future(3), ends_at: null }, { starts_at: future(4), ends_at: null }], location: '設置予定地', note: null, confirm: false };
    await expect(store.proposeCaseAppointment(customer, ids.request, proposal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const id = await store.proposeCaseAppointment(dealerA, ids.request, proposal);
    expect(notifications().some((n) => n.kind === 'case_appointment_proposed' && n.recipient_id === ids.customer)).toBe(true);
    await expect(store.confirmCaseAppointment(other, id, 0, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.confirmCaseAppointment(customer, id, 5, 1)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.confirmCaseAppointment(customer, id, 1, 9)).rejects.toMatchObject({ code: 'LOCKED' });
    await store.confirmCaseAppointment(customer, id, 1, 1);
    const [confirmed] = await store.listCaseAppointments(customer, ids.request);
    expect(confirmed).toMatchObject({ status: 'confirmed', confirmed_starts_at: proposal.candidates[1].starts_at, lock_version: 2 });
    expect(notifications().some((n) => n.kind === 'case_appointment_confirmed' && n.recipient_id === ids.dealerA)).toBe(true);
    await expect(store.confirmCaseAppointment(customer, id, 0, 2)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await store.listCaseAppointments(dealerB, ids.request)).toEqual([]);
    expect((await store.listBoardAppointments(dealerA)).map((a) => a.case_label)).toEqual(['Q-TEST-1 お客様 様']);
    expect(await store.listBoardAppointments(dealerB)).toEqual([]);
    await expect(store.setCaseAppointmentStatus(customer, id, 'done', 2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await store.setCaseAppointmentStatus(dealerA, id, 'done', 2);
    await expect(store.setCaseAppointmentStatus(dealerA, id, 'canceled', 3)).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('現地確認：担当だけが記録・完了でき、お客様には中身を見せない（完了したことだけ伝わる）', async () => {
    const input = { surveyed_on: '2026-10-20', surveyor_name: '担当', land: { area_sqm: '120㎡' }, legal: { zoning: '第一種住居地域' }, survey_notes: null };
    await expect(store.saveSiteSurvey(customer, ids.request, input, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.saveSiteSurvey(dealerA, ids.request, input, null)).toBe(1);
    expect(await store.getSiteSurvey(customer, ids.request)).toBeNull();
    expect(await store.setSiteSurveyStatus(dealerA, ids.request, 'completed', 1)).toBe(2);
    await expect(store.saveSiteSurvey(dealerA, ids.request, input, 2)).rejects.toMatchObject({ code: 'LOCKED' });
    expect((await store.getCaseProgress(customer, ids.request))?.site_survey_status).toBe('completed');
  });

  it('社内の記録：お客様は書けない。技術検討は本部と技術検討の担当だけ。相談の回答は本部だけ', async () => {
    await expect(store.addCaseNote(customer, ids.request, { kind: 'meeting', body: 'x', verdict: null, estimated_cost: null, parent_id: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const consult = await store.addCaseNote(dealerA, ids.request, { kind: 'consult', body: '基礎の仕様を相談したい', verdict: null, estimated_cost: null, parent_id: null });
    expect(notifications().some((n) => n.kind === 'case_consult' && n.recipient_id === null)).toBe(true);
    await expect(store.addCaseNote(dealerA, ids.request, { kind: 'tech_review', body: 'x', verdict: 'feasible', estimated_cost: null, parent_id: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.addCaseNote(dealerA, ids.request, { kind: 'consult_reply', body: 'x', verdict: null, estimated_cost: null, parent_id: consult })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await store.addCaseNote(admin, ids.request, { kind: 'consult_reply', body: '標準仕様で可', verdict: null, estimated_cost: null, parent_id: consult });
    await store.setCaseManufacturer(admin, ids.request, ids.master);
    await store.addCaseNote(master, ids.request, { kind: 'tech_review', body: '製造可', verdict: 'feasible', estimated_cost: 1200000, parent_id: null });
    const notes = await store.listCaseNotes(dealerA, ids.request);
    expect(notes.map((n) => [n.kind, n.author_name])).toEqual([
      ['consult', '担当代理店'],
      ['consult_reply', '本部'],
      ['tech_review', '総代理店'],
    ]);
    expect(await store.listCaseNotes(customer, ids.request)).toEqual([]);
  });

  it('写真・書類：お客様に見せるかを担当が選ぶ。お客様が送った資料はお客様にも見える', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const meta = (context: 'site_survey' | 'document', visible = false) => ({ context, context_id: null, file_name: 'a.png', content_type: 'image/png', size_bytes: 3, caption: null, customer_visible: visible });
    await expect(store.uploadCaseFile(customer, ids.request, meta('site_survey'), bytes)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const internal = await store.uploadCaseFile(dealerA, ids.request, meta('site_survey'), bytes);
    const fromCustomer = await store.uploadCaseFile(customer, ids.request, meta('document'), bytes);
    expect(fromCustomer.customer_visible).toBe(true);
    expect((await store.listCaseFiles(customer, ids.request)).map((f) => f.id)).toEqual([fromCustomer.id]);
    expect(await store.getCaseFileContent(customer, internal.id)).toBeNull();
    expect((await store.getCaseFileContent(dealerA, fromCustomer.id))?.bytes).toEqual(bytes);
    expect(await store.getCaseFileContent(dealerB, fromCustomer.id)).toBeNull();
    // お客様に表示していない資料は、削除できず存在も分からない
    await expect(store.deleteCaseFile(customer, internal.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.deleteCaseFile(dealerB, fromCustomer.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await store.deleteCaseFile(admin, internal.id);
    expect((await store.listCaseFiles(dealerA, ids.request)).map((f) => f.id)).toEqual([fromCustomer.id]);
  });
});
