import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalCaseFlowStore } from '@/lib/data/case-flow/local';
import { loadDb, saveDb } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';
import { normalizeGuestPlanInput, normalizeSiteProfileInput, siteProfileSummary, type GuestPlanInput } from '@/lib/domain/case-flow';
import type { BaseModel, Configuration, Profile, Quote, QuoteRequest, RoleCode } from '@/lib/domain/types';

/** フェーズ2（ログインなしの一時保存）・フェーズ3（設置予定地・土地）。DB（20261014100000）と同じ判定になっているか */

const ids = {
  admin: '00000000-0000-4000-8000-0000000004a1',
  dealer: '00000000-0000-4000-8000-0000000004d1',
  dealerB: '00000000-0000-4000-8000-0000000004d2',
  customer: '00000000-0000-4000-8000-0000000004c1',
  customerB: '00000000-0000-4000-8000-0000000004c2',
  model: '00000000-0000-4000-8000-0000000004b1',
  draftModel: '00000000-0000-4000-8000-0000000004b2',
  plan: '00000000-0000-4000-8000-0000000004e1',
  requestedPlan: '00000000-0000-4000-8000-0000000004e2',
  request: '00000000-0000-4000-8000-0000000004f1',
  quote: '00000000-0000-4000-8000-0000000004f2',
  option: '00000000-0000-4000-8000-0000000004aa',
};
const user = (id: string, role: RoleCode, name: string): SessionUser => ({ id, email: `${name}@example.invalid`, role, full_name: name });
const admin = user(ids.admin, 'admin', '本部');
const dealer = user(ids.dealer, 'dealer', '担当代理店');
const dealerB = user(ids.dealerB, 'dealer', '他の代理店');
const customer = user(ids.customer, 'customer', 'お客様');
const customerB = user(ids.customerB, 'customer', '他のお客様');

const guestPlan = (overrides: Partial<GuestPlanInput> = {}): GuestPlanInput =>
  normalizeGuestPlanInput({
    name: '海辺のプラン',
    option_ids: [ids.option],
    variant_choice_ids: [],
    exterior_faces: [],
    finish_level: 'full',
    spec_code: 'residence',
    site_prefecture: '石川県',
    site_municipality: '七尾市',
    site_location_undecided: false,
    ...overrides,
  });

function seed() {
  const db = loadDb();
  const now = new Date().toISOString();
  for (const u of [admin, dealer, dealerB, customer, customerB]) {
    db.profiles.push({ id: u.id, customer_no: null, email: u.email, full_name: u.full_name, company_name: null, phone: null, postal_code: null, address: null, role_code: u.role, created_at: now, updated_at: now } as Profile);
  }
  db.models.push({ id: ids.model, slug: 'wing-test', name: 'Wing', status: 'published' } as BaseModel, { id: ids.draftModel, slug: 'wing-draft', name: '下書き', status: 'draft' } as BaseModel);
  db.configurations.push(
    { id: ids.plan, user_id: ids.customer, base_model_id: ids.model, name: '検討中', status: 'draft', created_at: now, updated_at: now } as Configuration,
    { id: ids.requestedPlan, user_id: ids.customer, base_model_id: ids.model, name: '依頼済み', status: 'quote_requested', created_at: now, updated_at: now } as Configuration
  );
  db.quoteRequests.push({ id: ids.request, configuration_id: ids.requestedPlan, user_id: ids.customer, quote_id: ids.quote, status: 'sent', message: null, contact: { full_name: 'お客様', company_name: null, email: customer.email, phone: '0', address: 'x', site_address: null }, created_at: now, updated_at: now } as QuoteRequest);
  db.quotes.push({ id: ids.quote, quote_no: 'Q-LAND', quote_request_id: ids.request, configuration_id: ids.requestedPlan, user_id: ids.customer, dealer_id: ids.dealer, customer_name: 'お客様', revision: 1, status: 'issued', base_model_name: 'Wing', total: 1 } as unknown as Quote);
  saveDb(db);
}

describe('一時保存（ログインなし）と設置予定地・土地（ローカル検証モード）', () => {
  let dir = '';
  let store: LocalCaseFlowStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-p23-'));
    process.env.WING_LOCAL_DIR = dir;
    store = new LocalCaseFlowStore();
    seed();
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('一時保存は URL の鍵で開け、DB には鍵のハッシュだけが残る。鍵が違う・期限切れ・公開していない商品は開けない', async () => {
    const saved = await store.createGuestPlan(ids.model, guestPlan());
    expect(saved.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Date.parse(saved.expires_at) - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    const opened = await store.getGuestPlan(saved.token);
    expect(opened).toMatchObject({ base_model_id: ids.model, plan: { name: '海辺のプラン', option_ids: [ids.option], site_municipality: '七尾市' } });
    // 価格は保存しない
    expect(JSON.stringify(opened)).not.toMatch(/price|total|amount/);
    // 鍵そのものは保存しない
    expect(JSON.stringify(loadDb().caseFlow?.guestPlans)).not.toContain(saved.token);
    expect(await store.getGuestPlan('A'.repeat(32))).toBeNull();
    expect(await store.getGuestPlan('not-a-token')).toBeNull();
    await expect(store.createGuestPlan(ids.draftModel, guestPlan())).rejects.toMatchObject({ code: 'VALIDATION' });
    // 期限切れ
    const db = loadDb();
    db.caseFlow!.guestPlans![0].expires_at = new Date(Date.now() - 1000).toISOString();
    saveDb(db);
    expect(await store.getGuestPlan(saved.token)).toBeNull();
  });

  it('一時保存は 1 分あたり 60 件まで（混み合い対策）', async () => {
    const db = loadDb();
    db.caseFlow ??= { dealerProfiles: [], preferences: [], workflows: [], appointments: [], siteSurveys: [], notes: [], files: [] };
    const now = new Date().toISOString();
    db.caseFlow.guestPlans = Array.from({ length: 60 }, (_, i) => ({
      token_hash: i.toString(16).padStart(64, '0'),
      base_model_id: ids.model,
      plan: guestPlan(),
      created_at: now,
      expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    }));
    saveDb(db);
    await expect(store.createGuestPlan(ids.model, guestPlan())).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('土地の情報：読めるのは本人・本部・案件の担当代理店だけ。書けるのは本人と本部だけ', async () => {
    const owned = normalizeSiteProfileInput({ land_status: 'owned', site_address: '石川県七尾市○○1-2', area_sqm: '１,２００．５', land_category: 'residential', road_access: 'wide', electricity: 'available', water: 'unknown', drainage: 'unavailable', desired_area: '無視される', intended_use: 'villa' });
    expect(owned).toMatchObject({ area_sqm: 1200.5, desired_area: null, intended_use: null });
    await expect(store.saveSiteProfile(customerB, ids.plan, owned, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.saveSiteProfile(dealer, ids.requestedPlan, owned, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await store.saveSiteProfile(customer, ids.plan, owned, null)).toBe(1);
    await expect(store.saveSiteProfile(customer, ids.plan, owned, null)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await store.getSiteProfile(customerB, ids.plan)).toBeNull();
    expect(await store.getSiteProfile(admin, ids.plan)).toMatchObject({ land_status: 'owned', area_sqm: 1200.5 });

    // 見積を依頼したプラン：担当代理店は読めるが、関係の無い代理店は読めない
    const searching = normalizeSiteProfileInput({ land_status: 'none', site_address: '無視される', area_sqm: '100', desired_area: '能登の海沿い', intended_use: 'villa', land_budget: '3m_5m' });
    expect(searching).toMatchObject({ site_address: null, area_sqm: null, desired_area: '能登の海沿い' });
    expect(await store.saveSiteProfile(customer, ids.requestedPlan, searching, null)).toBe(1);
    expect(await store.getSiteProfile(dealer, ids.requestedPlan)).toMatchObject({ land_status: 'none', land_budget: '3m_5m' });
    expect(await store.getSiteProfile(dealerB, ids.requestedPlan)).toBeNull();
    // 本部は書ける。土地の有無を変えると、合わない項目は消える
    expect(await store.saveSiteProfile(admin, ids.requestedPlan, owned, 1)).toBe(2);
    expect(await store.getSiteProfile(customer, ids.requestedPlan)).toMatchObject({ land_status: 'owned', desired_area: null, intended_use: null, land_budget: null });
  });

  it('入力の検査と画面の要約', () => {
    expect(() => normalizeSiteProfileInput({})).toThrow('土地の有無');
    expect(() => normalizeSiteProfileInput({ land_status: 'owned', area_sqm: '100坪' })).toThrow('敷地面積');
    expect(() => normalizeSiteProfileInput({ land_status: 'owned', area_sqm: '0' })).toThrow('敷地面積');
    expect(() => normalizeSiteProfileInput({ land_status: 'owned', land_category: 'castle' })).toThrow('地目');
    expect(() => normalizeSiteProfileInput({ land_status: 'none', land_budget: 'billions' })).toThrow('土地のご予算');
    expect(() => normalizeGuestPlanInput({ option_ids: ['not-uuid'] })).toThrow('選んだ商品');
    expect(() => normalizeGuestPlanInput({ exterior_faces: [{}, {}, {}, {}, {}] })).toThrow('外壁');
    expect(normalizeGuestPlanInput({ option_ids: [ids.option.toUpperCase(), ids.option] }).option_ids).toEqual([ids.option]);
    const rows = siteProfileSummary({ ...normalizeSiteProfileInput({ land_status: 'owned', area_sqm: '330.58', road_access: 'narrow' }) });
    expect(rows).toEqual([
      { label: '土地', value: '土地あり' },
      { label: '敷地面積', value: '約 330.58㎡（約 100坪）' },
      { label: '前面道路', value: '幅 4m 未満の道路に接している' },
    ]);
  });
});

describe('フェーズ2〜3 の DB（20261014100000）と画面のつながり', () => {
  const root = process.cwd();
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
  const migration = read('supabase/migrations/20261014100000_guest_plans_site_profiles.sql');

  it('一時保存はサーバー（service_role）の RPC だけが読み書きし、鍵のハッシュだけを持つ。価格は持たない', () => {
    expect(migration).toContain("token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$')");
    expect(migration).toContain('revoke all on public.guest_plans from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.create_guest_plan(text, uuid, jsonb) to service_role;');
    expect(migration).toContain('grant execute on function public.get_guest_plan(text) to service_role;');
    expect(migration).not.toMatch(/grant execute on function public\.(create|get)_guest_plan[^;]*to (anon|authenticated)/);
    const keys = migration.slice(migration.indexOf("where k not in ("), migration.indexOf(')', migration.indexOf("where k not in (")));
    expect(keys).not.toMatch(/price|total|amount|email|phone/);
  });

  it('土地の情報は、本人・本部・案件の担当だけが読め（RLS）、書くのは RPC だけ。権限は書き込みより前に確かめる', () => {
    expect(migration).toContain('using (public.configuration_site_profile_access(configuration_id) is not null)');
    expect(migration).toContain("and public.case_access(r.id) in ('staff', 'manufacturer')");
    const save = migration.slice(migration.indexOf('create function public.save_configuration_site_profile'), migration.indexOf('$$;', migration.indexOf('create function public.save_configuration_site_profile')));
    expect(save).toContain("v_access not in ('owner', 'admin')");
    expect(save.indexOf('FORBIDDEN')).toBeLessThan(save.indexOf('insert into'));
    expect(save).toContain("if v_area_text !~ '^\\d{1,7}(\\.\\d{1,2})?$' then");
  });

  it('シミュレーター：未ログインの保存は、ログインして保存か一時保存（URL）を選べる。URL から開くと未保存の新しい下書きになる', () => {
    const app = read('components/simulator/simulator-app.tsx');
    const page = read('app/(site)/simulator/[slug]/page.tsx');
    const dialog = read('components/simulator/guest-save-dialog.tsx');
    expect(app).toContain('setGuestSave(true);');
    expect(app).toContain('<GuestSaveDialog');
    expect(dialog).toContain('data-testid="guest-save-login"');
    expect(dialog).toContain('data-testid="guest-save-temporary"');
    expect(dialog).toContain('createGuestPlanAction');
    expect(page).toContain('getGuestPlan(plan)');
    expect(page).toContain("lock_version: null,");
  });

  it('見積依頼の画面とマイページに土地の入力欄があり、利用者を引数で受け取る関数は use server のファイルから出さない', () => {
    const form = read('components/mypage/quote-request-form.tsx');
    const action = read('lib/actions/configurations.ts');
    const helper = read('lib/data/case-flow/site-profile-from-form.ts');
    expect(form).toContain('<SiteProfileFields');
    expect(action).toContain('saveSiteProfileFromForm(user, configuration_id, formData)');
    expect(helper.startsWith("import 'server-only';")).toBe(true);
    expect(helper).not.toMatch(/^\s*['"]use server['"];?\s*$/m);
    expect(read('app/(site)/mypage/page.tsx')).toContain('/land`');
    expect(read('components/case-flow/case-site-panels.tsx')).toContain('お客様が入力した設置予定地・土地');
  });
});
