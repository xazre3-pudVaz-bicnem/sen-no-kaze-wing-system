import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDb, saveDb } from '@/lib/data/local-db';
import { LocalCaseFlowStore } from '@/lib/data/case-flow/local';
import { emptyCaseFlowTables } from '@/lib/data/case-flow/local-tables';
import { LocalOrganizationStore } from '@/lib/data/organizations/local';
import type { SessionUser } from '@/lib/data/store';
import type { DealerProfile } from '@/lib/domain/case-flow';
import type { RoleCode } from '@/lib/domain/types';

// お客様が代理店を選ぶ（20261111150000）：ローカル検証モードも DB と同じ条件で営業担当組織を決める
// （見積依頼の直後に初めて希望を保存したときだけ・設置予定地に対応している代理店だけ）

describe.sequential('お客様が代理店を選ぶ：ローカル検証モード（DB と同じ条件）', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-dealer-selection-'));
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_MODE = '1';
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const at = () => new Date().toISOString();

  function addUser(id: string, role: RoleCode): SessionUser {
    const db = loadDb();
    const email = `${id}@example.com`;
    db.users.push({ id, email, password_hash: 'x', salt: 'x', created_at: at() });
    db.profiles.push({
      id,
      customer_no: null,
      email,
      full_name: id,
      company_name: null,
      phone: null,
      postal_code: null,
      address: null,
      role_code: role,
      created_at: at(),
      updated_at: at(),
    });
    saveDb(db);
    return { id, email, role, full_name: id };
  }

  function publishProfile(dealerId: string, prefectures: string[] = []) {
    const db = loadDb();
    db.caseFlow ??= emptyCaseFlowTables();
    const profile: DealerProfile = {
      dealer_id: dealerId,
      display_name: dealerId,
      intro: null,
      service_prefectures: prefectures,
      service_municipalities: [],
      services: [],
      qualifications: null,
      track_record: null,
      completed_count: null,
      phone: null,
      website_url: null,
      published: true,
      published_at: at(),
      lock_version: 1,
      updated_at: at(),
    };
    db.caseFlow.dealerProfiles.push(profile);
    saveDb(db);
  }

  function addRequest(id: string, customerId: string, options: { createdAt?: string; prefecture?: string } = {}) {
    const db = loadDb();
    const configurationId = `${id}-config`;
    db.configurations.push({
      id: configurationId,
      user_id: customerId,
      site_prefecture: options.prefecture ?? null,
      site_municipality: null,
    } as never);
    db.quoteRequests.push({
      id,
      configuration_id: configurationId,
      user_id: customerId,
      quote_id: null,
      status: 'new',
      message: null,
      contact: {} as never,
      created_at: options.createdAt ?? at(),
      updated_at: at(),
    });
    saveDb(db);
  }

  const choose = (customer: SessionUser, requestId: string, dealerId: string) =>
    new LocalCaseFlowStore().setQuoteRequestPreferences(customer, requestId, {
      preferred_dealer_id: dealerId,
      meeting_method: null,
      preferred_slots: [],
      note: null,
    });
  const workflowOf = (requestId: string) => loadDb().caseFlow?.workflows.find((w) => w.quote_request_id === requestId);
  const adminNotified = (kind: string, requestId: string) =>
    loadDb().notifications.some((n) => n.audience === 'admin' && n.kind === kind && (n.link ?? '').includes(requestId));

  /** 総代理店・代理店（管理者と担当者）を登録し、担当者の紹介ページを公開する */
  async function setup() {
    const orgs = new LocalOrganizationStore();
    const admin = addUser('hq', 'admin');
    const manager = addUser('mgr', 'customer');
    const staff = addUser('staff', 'customer');
    const customer = addUser('customer', 'customer');
    const md = await orgs.createOrganization(admin, { organization_type: 'master_dealer', name: '検査総代理店', parent_organization_id: null });
    const dealer = await orgs.createOrganization(admin, { organization_type: 'dealer', name: '検査代理店', parent_organization_id: md });
    await orgs.acceptInvitation(manager, (await orgs.inviteMember(admin, dealer, manager.email, 'admin')).token);
    await orgs.acceptInvitation(staff, (await orgs.inviteMember(admin, dealer, staff.email, 'editor')).token);
    publishProfile(staff.id);
    return { admin, customer, staff: { ...staff, role: 'dealer' as RoleCode }, md, dealer };
  }

  it('見積依頼の直後に組織の代理店を選ぶと、その組織が営業担当・製造担当は直属の総代理店になり、候補の一覧にも出る', async () => {
    const { customer, staff, md, dealer } = await setup();
    addRequest('r1', customer.id);
    await choose(customer, 'r1', staff.id);
    expect(workflowOf('r1')).toMatchObject({
      sales_organization_id: dealer,
      sales_assigned_by: customer.id,
      manufacturing_organization_id: md,
      manufacturing_auto: true,
    });
    expect(adminNotified('case_sales_assigned', 'r1')).toBe(true);
    expect(adminNotified('case_preferred_dealer', 'r1')).toBe(false);
    expect(await new LocalCaseFlowStore().listSelectableDealerIds(customer)).toEqual([staff.id]);
  });

  it('2 回目の保存・依頼から時間がたった案件では決めず、本部に「相談したい代理店」を送る', async () => {
    const { admin, customer, staff } = await setup();
    addRequest('r1', customer.id);
    await choose(customer, 'r1', staff.id);
    await new LocalCaseFlowStore().setCaseSalesOrganization(admin, 'r1', null);
    await choose(customer, 'r1', staff.id);
    expect(workflowOf('r1')?.sales_organization_id ?? null).toBeNull();

    addRequest('r-old', customer.id, { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() });
    await choose(customer, 'r-old', staff.id);
    expect(workflowOf('r-old')?.sales_organization_id ?? null).toBeNull();
    expect(adminNotified('case_preferred_dealer', 'r-old')).toBe(true);
  });

  it('設置予定地に対応していない代理店は選べない（希望も保存しない）', async () => {
    const { customer } = await setup();
    const area = addUser('area', 'dealer');
    publishProfile(area.id, ['富山県']);
    addRequest('r-ishikawa', customer.id, { prefecture: '石川県' });
    await expect(choose(customer, 'r-ishikawa', area.id)).rejects.toThrow('設置予定地に対応していません');
    expect(loadDb().caseFlow?.preferences.some((p) => p.quote_request_id === 'r-ishikawa')).toBe(false);
  });
});
