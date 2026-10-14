import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CaseFlowValidationError,
  canChangeAppointmentStatus,
  canRegisterCaseFile,
  dealerServesArea,
  normalizeAppointmentInput,
  normalizeCaseFileInput,
  normalizeCaseNoteInput,
  normalizeDealerProfileInput,
  normalizePreferencesInput,
  normalizeSiteSurveyInput,
} from '@/lib/domain/case-flow';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013220000_case_flow_intake_site.sql');

describe('案件の進行：入力の検査（DB の RPC と同じ規則）', () => {
  it('代理店の紹介ページ：表示名は必須、施工対応は決まった項目だけ、URL は https だけ', () => {
    expect(() => normalizeDealerProfileInput({ display_name: ' ' })).toThrow(CaseFlowValidationError);
    expect(() => normalizeDealerProfileInput({ display_name: 'A', services: ['painting'] })).toThrow('施工対応の項目が正しくありません');
    expect(() => normalizeDealerProfileInput({ display_name: 'A', website_url: 'http://example.com' })).toThrow('https://');
    const ok = normalizeDealerProfileInput({ display_name: ' 能登工務店 ', service_prefectures: ['石川県', '石川県', ''], services: ['foundation'] });
    expect(ok).toMatchObject({ display_name: '能登工務店', service_prefectures: ['石川県'], services: ['foundation'] });
  });

  it('対応エリア：市区町村の指定がある都道府県は、その市区町村だけを対象にする', () => {
    const dealer = { service_prefectures: ['石川県', '千葉県'], service_municipalities: ['石川県/七尾市'] };
    expect(dealerServesArea(dealer, null, null)).toBe(true);
    expect(dealerServesArea(dealer, '石川県', '七尾市')).toBe(true);
    expect(dealerServesArea(dealer, '石川県', '金沢市')).toBe(false);
    expect(dealerServesArea(dealer, '千葉県', '千葉市')).toBe(true);
    expect(dealerServesArea(dealer, '富山県', null)).toBe(false);
  });

  it('打合せの希望日：3 つまで、今日から 1 年以内', () => {
    const today = '2026-10-13';
    expect(() => normalizePreferencesInput({ preferred_slots: [{ date: '2026-10-12' }] }, today)).toThrow('今日から 1 年以内');
    expect(() => normalizePreferencesInput({ preferred_slots: [{ date: '2027-10-14' }] }, today)).toThrow('今日から 1 年以内');
    expect(() => normalizePreferencesInput({ preferred_slots: [1, 2, 3, 4] }, today)).toThrow('3 つまで');
    expect(normalizePreferencesInput({ meeting_method: 'online', preferred_slots: [{ date: '2026-10-20', period: 'pm' }] }, today)).toEqual({
      preferred_dealer_id: null,
      meeting_method: 'online',
      preferred_slots: [{ date: '2026-10-20', period: 'pm' }],
      note: null,
    });
  });

  it('日程：候補は 1〜5 つ、終了は開始より後、確定するときは候補 1 つ', () => {
    const now = new Date('2026-10-13T00:00:00Z');
    const c = (iso: string, end: string | null = null) => ({ starts_at: iso, ends_at: end });
    expect(() => normalizeAppointmentInput({ candidates: [] }, now)).toThrow('1〜5');
    expect(() => normalizeAppointmentInput({ candidates: [c('2026-10-20T01:00:00Z', '2026-10-20T00:00:00Z')] }, now)).toThrow('終了の時刻');
    expect(() => normalizeAppointmentInput({ candidates: [c('2026-10-01T00:00:00Z')] }, now)).toThrow('今日以降');
    expect(() => normalizeAppointmentInput({ confirm: true, candidates: [c('2026-10-20T01:00:00Z'), c('2026-10-21T01:00:00Z')] }, now)).toThrow('候補を 1 つ');
    expect(normalizeAppointmentInput({ purpose: 'site_survey', method: 'onsite', candidates: [c('2026-10-20T01:00:00Z')] }, now)).toMatchObject({
      purpose: 'site_survey',
      confirm: false,
      candidates: [{ starts_at: '2026-10-20T01:00:00.000Z', ends_at: null }],
    });
    expect(canChangeAppointmentStatus('proposed', 'canceled')).toBe(true);
    expect(canChangeAppointmentStatus('proposed', 'done')).toBe(false);
    expect(canChangeAppointmentStatus('confirmed', 'done')).toBe(true);
    expect(canChangeAppointmentStatus('done', 'canceled')).toBe(false);
  });

  it('現地確認：決まった項目だけを保存する', () => {
    const input = normalizeSiteSurveyInput({ surveyed_on: '2026-10-20', land: { area_sqm: '120', unknown: 'x' }, legal: { zoning: '第一種住居地域' } });
    expect(input.land).toEqual({ area_sqm: '120' });
    expect(input.legal).toEqual({ zoning: '第一種住居地域' });
    expect(() => normalizeSiteSurveyInput({ surveyed_on: '2026/10/20' })).toThrow('確認日の形式');
  });

  it('社内の記録：技術検討は製造可否が必須、回答は相談の指定が必須', () => {
    expect(() => normalizeCaseNoteInput({ kind: 'tech_review', body: 'x' })).toThrow('製造可否');
    expect(() => normalizeCaseNoteInput({ kind: 'consult_reply', body: 'x' })).toThrow('回答する相談');
    expect(normalizeCaseNoteInput({ kind: 'meeting', body: ' 打合せ ' })).toEqual({ kind: 'meeting', body: '打合せ', verdict: null, estimated_cost: null, parent_id: null });
  });

  it('写真・書類：画像と PDF だけ、20MB まで。お客様は案件資料・指摘事項・アフターだけ登録できる', () => {
    const base = { context: 'document', file_name: 'a.png', content_type: 'image/png', size_bytes: 10 };
    expect(() => normalizeCaseFileInput({ ...base, content_type: 'text/html' })).toThrow('JPEG・PNG・WebP');
    expect(() => normalizeCaseFileInput({ ...base, size_bytes: 21 * 1024 * 1024 })).toThrow('20MB');
    expect(canRegisterCaseFile('customer', 'document')).toBe(true);
    expect(canRegisterCaseFile('customer', 'site_survey')).toBe(false);
    expect(canRegisterCaseFile('customer', 'contract')).toBe(false);
    expect(canRegisterCaseFile('manufacturer', 'progress')).toBe(true);
    expect(canRegisterCaseFile('manufacturer', 'site_survey')).toBe(false);
    expect(canRegisterCaseFile('staff', 'contract')).toBe(false);
  });
});

describe('案件の進行：DB（20261013220000）', () => {
  it('すべての表は RLS を有効にし、API からは読み取りだけ（書き込みは RPC）', () => {
    for (const table of ['dealer_profiles', 'quote_request_preferences', 'case_workflows', 'case_appointments', 'site_surveys', 'case_notes', 'case_files']) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
      expect(migration).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
      expect(migration).not.toMatch(new RegExp(`grant (insert|update|delete)[^;]* on public\\.${table}`));
    }
    // 未ログインの利用者が読めるのは、公開中の代理店の紹介だけ
    expect(migration).toContain('grant select on public.dealer_profiles to anon, authenticated;');
    expect(migration.match(/to anon/g)?.length).toBe(2);
    expect(migration).toContain('create policy dealer_profiles_public_read on public.dealer_profiles for select to anon, authenticated\n  using (published);');
  });

  it('お客様に見せない情報（現地確認・社内の記録・担当の設定）は、お客様から読めない', () => {
    for (const table of ['case_workflows', 'site_surveys', 'case_notes']) {
      const policy = migration.slice(migration.indexOf(`create policy ${table}_read`), migration.indexOf(';', migration.indexOf(`create policy ${table}_read`)));
      expect(policy).toContain("in ('admin', 'staff', 'manufacturer')");
      expect(policy).not.toContain("'customer'");
    }
    const files = migration.slice(migration.indexOf('create policy case_files_read'), migration.indexOf(';', migration.indexOf('create policy case_files_read')));
    expect(files).toContain("customer_visible and public.case_access(quote_request_id) = 'customer'");
  });

  it('画面からの操作はすべて SECURITY DEFINER の RPC で、権限は状態の判定より前に確認する', () => {
    const rpcs = [
      'save_dealer_profile',
      'set_dealer_profile_published',
      'set_quote_request_preferences',
      'acknowledge_case',
      'assign_case_primary_staff',
      'set_case_manufacturer',
      'propose_case_appointment',
      'confirm_case_appointment',
      'request_case_appointment_change',
      'set_case_appointment_status',
      'save_site_survey',
      'set_site_survey_status',
      'add_case_note',
      'register_case_file',
      'delete_case_file',
    ];
    for (const name of rpcs) {
      const start = migration.indexOf(`create function public.${name}(`);
      expect(start, name).toBeGreaterThan(0);
      const body = migration.slice(start, migration.indexOf('$$;', start));
      expect(body, name).toContain('security definer');
      expect(body, name).toContain("set search_path = ''");
      expect(body, name).toContain("raise exception 'UNAUTHENTICATED'");
      // 権限の判定（FORBIDDEN / 見えない案件は NOT_FOUND）が、行のロック・更新より前にある
      const firstAuth = Math.min(
        ...['FORBIDDEN', 'NOT_FOUND'].map((word) => body.indexOf(word)).filter((i) => i > 0)
      );
      const firstWrite = Math.min(...['insert into', 'update public.', 'delete from'].map((word) => body.indexOf(word)).filter((i) => i > 0));
      expect(firstAuth, name).toBeLessThan(firstWrite);
    }
    expect(migration).toContain("execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);");
  });

  it('写真・書類の保存先は非公開で、保存先の名前は DB が決める', () => {
    expect(migration).toContain("values ('case-files', 'case-files', false, 20971520");
    expect(migration).toContain("v_path := 'cases/' || p_request_id::text || '/' || v_id::text || '.' || v_ext;");
    expect(migration).toContain("raise exception 'POSTCONDITION: case-files bucket must be private';");
  });
});
