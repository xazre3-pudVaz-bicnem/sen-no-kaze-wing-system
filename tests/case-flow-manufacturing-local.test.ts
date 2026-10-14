import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalCaseFlowStore } from '@/lib/data/case-flow/local';
import { loadDb, saveDb } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';
import { canChangeOrderStatus, canSetUnitStatus, normalizeManufacturingOrderInput, normalizeScheduleItemInput } from '@/lib/domain/case-flow';
import type { ElectronicContract, Profile, Quote, QuoteItem, QuoteRequest, RoleCode } from '@/lib/domain/types';

/** フェーズ11〜13（製造依頼・個体・工程表・施工の記録）。DB（20261013234000）と同じ判定になっているか */

const ids = {
  admin: '00000000-0000-4000-8000-0000000002a1',
  dealer: '00000000-0000-4000-8000-0000000002d1',
  dealerB: '00000000-0000-4000-8000-0000000002d2',
  master: '00000000-0000-4000-8000-0000000002e1',
  customer: '00000000-0000-4000-8000-0000000002c1',
  request: '00000000-0000-4000-8000-0000000002f1',
  quote: '00000000-0000-4000-8000-0000000002f2',
  contract: '00000000-0000-4000-8000-0000000002f3',
};
const user = (id: string, role: RoleCode, name: string): SessionUser => ({ id, email: `${name}@example.invalid`, role, full_name: name });
const admin = user(ids.admin, 'admin', '本部');
const dealer = user(ids.dealer, 'dealer', '担当代理店');
const dealerB = user(ids.dealerB, 'dealer', '他の代理店');
const master = user(ids.master, 'master_dealer', '総代理店');
const customer = user(ids.customer, 'customer', 'お客様');
const order = (n = 2) => ({ unit_count: n, requested_delivery_on: null, spec_note: '標準仕様', supply_note: null });

function seed(signed: boolean) {
  const db = loadDb();
  const now = new Date().toISOString();
  for (const u of [admin, dealer, dealerB, master, customer]) {
    db.profiles.push({ id: u.id, customer_no: null, email: u.email, full_name: u.full_name, company_name: null, phone: null, postal_code: null, address: null, role_code: u.role, created_at: now, updated_at: now } as Profile);
  }
  db.quoteRequests.push({ id: ids.request, configuration_id: null, user_id: ids.customer, quote_id: ids.quote, status: 'sent', message: null, contact: { full_name: 'お客様', company_name: null, email: customer.email, phone: '0', address: 'x', site_address: null }, created_at: now, updated_at: now } as QuoteRequest);
  db.quotes.push({ id: ids.quote, quote_no: 'Q-MFG', quote_request_id: ids.request, user_id: ids.customer, dealer_id: ids.dealer, customer_name: 'お客様', revision: 2, status: 'accepted', base_model_name: 'Wing', total: 5000000 } as unknown as Quote);
  db.quoteItems.push({ id: 'qi-1', quote_id: ids.quote, kind: 'base', name: '本体一式', unit_price: 3000000, quantity: 1, amount: 3000000, sort_order: 0 } as unknown as QuoteItem);
  if (signed) {
    db.contracts.push({ id: ids.contract, quote_request_id: ids.request, quote_id: ids.quote, user_id: ids.customer, provider: 'paper', status: 'signed', signer_name: 'お客様', signer_email: customer.email, contract_total: 5000000, envelope_xid: null, provider_document_id: null, signed_file_path: 'contracts/paper/x.pdf', failure_reason: null, sent_at: null, signed_at: now, canceled_at: null, created_at: now, updated_at: now } as ElectronicContract);
  }
  saveDb(db);
}

describe('製造依頼・個体・工程表・施工の記録（ローカル検証モード）', () => {
  let dir = '';
  let store: LocalCaseFlowStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-case-mfg-'));
    process.env.WING_LOCAL_DIR = dir;
    store = new LocalCaseFlowStore();
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('製造依頼は締結済みの契約がある案件だけ・1 件だけ。総代理店が決まるまで送れない', async () => {
    seed(false);
    await expect(store.createManufacturingOrder(dealer, ids.request, order())).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('担当代理店が作って送り、総代理店が受領・製造・出荷、担当代理店が完了。製造仕様は価格を写さない', async () => {
    seed(true);
    await expect(store.createManufacturingOrder(customer, ids.request, order())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.createManufacturingOrder(dealerB, ids.request, order())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const id = await store.createManufacturingOrder(dealer, ids.request, order(2));
    await expect(store.createManufacturingOrder(dealer, ids.request, order())).rejects.toMatchObject({ code: 'LOCKED' });
    expect((await store.listManufacturingUnits(dealer, id)).map((u) => [u.seq, u.status, u.unit_no])).toEqual([
      [1, 'planned', null],
      [2, 'planned', null],
    ]);
    // 送る前は棟数を変えられ、個体を作り直す
    expect(await store.updateManufacturingOrder(dealer, id, order(3), 1)).toBe(2);
    expect(await store.listManufacturingUnits(dealer, id)).toHaveLength(3);
    await expect(store.sendManufacturingOrder(dealer, id, 2)).rejects.toMatchObject({ code: 'LOCKED' });
    await store.setCaseManufacturer(admin, ids.request, ids.master);
    expect(await store.sendManufacturingOrder(dealer, id, 2)).toBe(3);
    const sent = await store.getManufacturingOrder(master, ids.request);
    expect(sent).toMatchObject({ status: 'sent', manufacturer_id: ids.master, order_no: null });
    expect(JSON.stringify(sent?.spec_snapshot)).not.toMatch(/unit_price|amount|3000000/);
    expect(sent?.spec_snapshot?.items).toEqual([{ kind: 'base', name: '本体一式', quantity: 1, unit: null }]);
    expect(loadDb().notifications.some((n) => n.kind === 'manufacturing_order_sent' && n.recipient_id === ids.master)).toBe(true);
    // 送った後は担当代理店は変えられない
    await expect(store.updateManufacturingOrder(dealer, id, order(1), 3)).rejects.toMatchObject({ code: 'LOCKED' });
    // 受領・製造・出荷は総代理店、完了は担当代理店
    await expect(store.setManufacturingOrderStatus(dealer, id, 'received', 3, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.setManufacturingOrderStatus(master, id, 'received', 3, null)).toBe(4);
    await expect(store.setManufacturingOrderStatus(master, id, 'shipped', 4, null)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await store.setManufacturingOrderStatus(master, id, 'in_production', 4, null)).toBe(5);
    expect(await store.setManufacturingOrderStatus(master, id, 'shipped', 5, null)).toBe(6);
    await expect(store.setManufacturingOrderStatus(master, id, 'completed', 6, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.setManufacturingOrderStatus(dealer, id, 'canceled', 6, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.setManufacturingOrderStatus(dealer, id, 'completed', 6, null)).toBe(7);
  });

  it('個体：製造・検査・出荷は総代理店、設置・引渡しは担当代理店。状態は前へだけ（本部は戻せる）', async () => {
    seed(true);
    const id = await store.createManufacturingOrder(dealer, ids.request, order(1));
    const [unit] = await store.listManufacturingUnits(dealer, id);
    const input = (status: 'in_production' | 'shipped' | 'installed' | 'planned') => ({ status, produced_on: null, inspected_on: null, shipped_on: null, installed_on: null, handed_over_on: null, note: null });
    await expect(store.updateManufacturingUnit(admin, unit.id, input('in_production'), 1)).rejects.toMatchObject({ code: 'LOCKED' });
    await store.setCaseManufacturer(admin, ids.request, ids.master);
    await store.sendManufacturingOrder(dealer, id, 1);
    await expect(store.updateManufacturingUnit(dealer, unit.id, input('in_production'), 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.updateManufacturingUnit(master, unit.id, { ...input('shipped'), shipped_on: '2026-10-20' }, 1)).toBe(2);
    await expect(store.updateManufacturingUnit(master, unit.id, input('installed'), 2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.updateManufacturingUnit(master, unit.id, input('in_production'), 2)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await store.updateManufacturingUnit(dealer, unit.id, input('installed'), 2)).toBe(3);
    expect(await store.updateManufacturingUnit(admin, unit.id, input('planned'), 3)).toBe(4);
    expect(canSetUnitStatus('manufacturer', 'planned', 'shipped')).toBe(true);
    expect(canSetUnitStatus('staff', 'planned', 'shipped')).toBe(false);
  });

  it('工程表：総代理店は製造・検査・出荷だけ。お客様には「お客様に表示」の工程だけ見え、表示にしたら知らせる', async () => {
    seed(true);
    await store.setCaseManufacturer(admin, ids.request, ids.master);
    const item = (category: 'manufacturing' | 'foundation', visible: boolean) =>
      normalizeScheduleItemInput({ category, title: category === 'foundation' ? '基礎工事' : '製造', planned_start: '2026-11-01', planned_end: '2026-11-03', customer_visible: visible });
    await expect(store.saveScheduleItem(master, ids.request, null, item('foundation', false), null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const made = await store.saveScheduleItem(master, ids.request, null, item('manufacturing', true), null);
    // 総代理店はお客様への表示を決められない
    expect((await store.listScheduleItems(customer, ids.request)).length).toBe(0);
    const foundation = await store.saveScheduleItem(dealer, ids.request, null, item('foundation', false), null);
    await store.saveScheduleItem(dealer, ids.request, foundation.id, item('foundation', true), foundation.lock_version);
    expect((await store.listScheduleItems(customer, ids.request)).map((i) => i.title)).toEqual(['基礎工事']);
    expect(loadDb().notifications.some((n) => n.kind === 'case_schedule_updated' && n.recipient_id === ids.customer)).toBe(true);
    await expect(store.saveScheduleItem(dealer, ids.request, foundation.id, item('foundation', true), foundation.lock_version)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(store.deleteScheduleItem(customer, made.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await store.deleteScheduleItem(master, made.id);
    expect((await store.listScheduleItems(dealer, ids.request)).map((i) => i.title)).toEqual(['基礎工事']);
  });

  it('施工の記録：お客様には表示にした記録だけ。総代理店は進み具合と技術支援だけで、表示は決められない', async () => {
    seed(true);
    await store.setCaseManufacturer(admin, ids.request, ids.master);
    const report = (kind: 'progress' | 'completion' | 'support', visible: boolean) => ({ kind, title: `${kind} の記録`, body: null, reported_on: '2026-10-13', schedule_item_id: null, customer_visible: visible });
    await expect(store.addProgressReport(customer, ids.request, report('progress', true))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.addProgressReport(master, ids.request, report('completion', false))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const support = await store.addProgressReport(master, ids.request, report('support', true));
    const done = await store.addProgressReport(dealer, ids.request, report('completion', true));
    expect((await store.listProgressReports(customer, ids.request)).map((r) => r.id)).toEqual([done]);
    expect(loadDb().notifications.filter((n) => n.kind === 'case_progress_reported')).toHaveLength(1);
    await expect(store.setProgressReportVisibility(master, support, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await store.setProgressReportVisibility(dealer, support, true);
    expect(await store.listProgressReports(customer, ids.request)).toHaveLength(2);
    expect((await store.getCaseProgress(customer, ids.request))?.manufacturing_status).toBe('none');
  });

  it('入力の検査と、状態の変更の規則', () => {
    expect(() => normalizeManufacturingOrderInput({ unit_count: 0 }, '2026-10-13')).toThrow('棟数');
    expect(() => normalizeManufacturingOrderInput({ unit_count: 'x' }, '2026-10-13')).toThrow('棟数');
    expect(() => normalizeManufacturingOrderInput({ unit_count: 1, requested_delivery_on: '2026-10-12' }, '2026-10-13')).toThrow('希望納期');
    expect(() => normalizeScheduleItemInput({ category: 'foundation', title: 'x', planned_start: '2026-11-03', planned_end: '2026-11-01' })).toThrow('終了日');
    expect(canChangeOrderStatus('manufacturer', 'sent', 'received')).toBe(true);
    expect(canChangeOrderStatus('staff', 'sent', 'received')).toBe(false);
    expect(canChangeOrderStatus('staff', 'shipped', 'completed')).toBe(true);
    expect(canChangeOrderStatus('admin', 'completed', 'canceled')).toBe(false);
  });
});

describe('フェーズ11〜13 の DB（20261013234000）', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261013234000_case_flow_manufacturing_schedule.sql'), 'utf8').split('\r').join('');

  it('お客様は製造依頼・個体を読めず、工程表・施工の記録は「お客様に表示」だけ', () => {
    for (const table of ['manufacturing_orders', 'manufacturing_units']) {
      const policy = migration.slice(migration.indexOf(`create policy ${table}_read`), migration.indexOf(';', migration.indexOf(`create policy ${table}_read`)));
      expect(policy).toContain("in ('admin', 'staff', 'manufacturer')");
      expect(policy).not.toContain("'customer'");
    }
    for (const table of ['case_schedule_items', 'case_progress_reports']) {
      const policy = migration.slice(migration.indexOf(`create policy ${table}_read`), migration.indexOf(';', migration.indexOf(`create policy ${table}_read`)));
      expect(policy).toContain("customer_visible and public.case_access(quote_request_id) = 'customer'");
    }
  });

  it('製造仕様のスナップショットは品名・数量だけ（価格を写さない）。注文番号・個体番号は発行しない', () => {
    const send = migration.slice(migration.indexOf('create function public.send_manufacturing_order'), migration.indexOf('create function public.set_manufacturing_order_status'));
    expect(send).toContain("'name', qi.name");
    expect(send).not.toMatch(/unit_price|qi\.amount|q\.total/);
    expect(migration).not.toMatch(/(order_no|unit_no)\s*=\s*[^n]/);
    expect(migration).toContain('order_no text unique');
  });

  it('画面からの操作は SECURITY DEFINER の RPC で、権限は状態の判定より前に確認する', () => {
    for (const name of [
      'create_manufacturing_order',
      'update_manufacturing_order',
      'send_manufacturing_order',
      'set_manufacturing_order_status',
      'update_manufacturing_unit',
      'save_case_schedule_item',
      'delete_case_schedule_item',
      'add_case_progress_report',
      'set_case_progress_report_visibility',
    ]) {
      const start = migration.indexOf(`create function public.${name}(`);
      expect(start, name).toBeGreaterThan(0);
      const body = migration.slice(start, migration.indexOf('$$;', start));
      expect(body, name).toContain('security definer');
      expect(body, name).toContain("set search_path = ''");
      const firstAuth = Math.min(...['FORBIDDEN', 'NOT_FOUND'].map((w) => body.indexOf(w)).filter((i) => i > 0));
      const firstWrite = Math.min(...['insert into', 'update public.', 'delete from'].map((w) => body.indexOf(w)).filter((i) => i > 0));
      expect(firstAuth, name).toBeLessThan(firstWrite);
    }
  });
});
