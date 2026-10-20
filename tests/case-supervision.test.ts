import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { caseStageOf, type CaseProgress } from '@/lib/domain/case-flow';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261016140000_case_supervision.sql'), 'utf8');
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const functionBody = (name: string) => {
  const start = sqlOnly.indexOf(`create function public.${name}(`);
  return sqlOnly.slice(start, sqlOnly.indexOf('\n$$;', start));
};

describe('総代理店の配下の確認：DB の取り決め（migration 20261016140000）', () => {
  it('お客様の氏名・会社名・連絡先・設置場所・備考・営業の記録を返さない（顧客情報の項目は先方の確認待ち）', () => {
    for (const name of ['list_supervised_cases', 'get_supervised_case']) {
      const body = functionBody(name);
      expect(body.length).toBeGreaterThan(200);
      for (const field of [
        'customer_name',
        'customer_company',
        'customer_note',
        'customer_no',
        'dealer_note',
        'adjustment_reason',
        'site_address',
        'configuration_site_profiles',
        'site_surveys',
        'case_notes',
        'case_files',
        'quote_request_preferences',
        'contracts',
        'email',
        'phone',
      ]) {
        expect(body, `${name} に ${field} が含まれている`).not.toContain(field);
      }
      expect(body).not.toMatch(/'notes'|\.notes\b/);
    }
  });

  it('一覧は本部か、営業担当（代理店）の直属の総代理店の有効な管理者だけ。詳細は is_case_supervisor で確かめる', () => {
    const list = functionBody('list_supervised_cases');
    expect(list).toContain("join public.organizations s on s.id = w.sales_organization_id and s.organization_type = 'dealer'");
    expect(list).toContain('join public.organizations p on p.id = s.parent_organization_id');
    expect(list).toContain("p.status = 'active'");
    expect(list).toContain("om.member_role in ('owner', 'admin')");
    const detail = functionBody('get_supervised_case');
    expect(detail).toContain('public.is_case_supervisor(p_request_id)');
    expect(detail).toContain("errcode = '42501'");
  });

  it('呼べるのはログインした利用者だけ（未ログイン・service_role は不可）', () => {
    expect(migration).toContain('grant execute on function public.list_supervised_cases() to authenticated;');
    expect(migration).toContain('grant execute on function public.get_supervised_case(uuid) to authenticated;');
    expect(migration).not.toMatch(/grant execute on function public\.(list_supervised_cases|get_supervised_case)\([^)]*\) to [^;]*anon/);
  });

  it('案件・見積の表の RLS は開かない（専用の関数だけで返す）', () => {
    expect(sqlOnly).not.toMatch(/create policy|alter policy|drop policy/);
  });
});

describe('配下の案件の進み具合（caseStageOf）', () => {
  const base: CaseProgress = {
    acknowledged_at: null,
    primary_staff_name: null,
    site_survey_status: 'none',
    site_survey_completed_at: null,
    manufacturing_status: 'none',
    contract_signed: false,
    handover_status: 'none',
  };

  it('いちばん先に進んだ段階を返す', () => {
    expect(caseStageOf(null).label).toBe('—');
    expect(caseStageOf(base)).toEqual({ label: '受付待ち', tone: 'warn' });
    expect(caseStageOf({ ...base, acknowledged_at: '2026-10-15T00:00:00Z' }).label).toBe('受付済み');
    expect(caseStageOf({ ...base, acknowledged_at: '2026-10-15T00:00:00Z', primary_staff_name: '担当' }).label).toBe('主担当者が決定');
    expect(caseStageOf({ ...base, site_survey_status: 'completed' }).label).toBe('現地確認済み');
    expect(caseStageOf({ ...base, contract_signed: true }).label).toBe('契約済み');
    expect(caseStageOf({ ...base, contract_signed: true, manufacturing_status: 'in_production' })).toEqual({ label: '製造：製造中', tone: 'warn' });
    expect(caseStageOf({ ...base, manufacturing_status: 'completed' })).toEqual({ label: '製造：完了', tone: 'success' });
    expect(caseStageOf({ ...base, manufacturing_status: 'completed', handover_status: 'correcting' }).label).toBe('完成確認：是正中');
    expect(caseStageOf({ ...base, handover_status: 'handed_over' })).toEqual({ label: '引渡し済み', tone: 'success' });
  });

  it('取り消した製造依頼は製造の段階として扱わない', () => {
    expect(caseStageOf({ ...base, contract_signed: true, manufacturing_status: 'canceled' }).label).toBe('契約済み');
  });
});
