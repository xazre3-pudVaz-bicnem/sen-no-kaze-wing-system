import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { caseStageOf, type CaseProgress } from '@/lib/domain/case-flow';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261111130000_case_supervision.sql'), 'utf8');
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const functionBody = (name: string) => {
  const start = sqlOnly.indexOf(`create function public.${name}(`);
  return sqlOnly.slice(start, sqlOnly.indexOf('\n$$;', start));
};

describe('総代理店の配下の確認：DB の取り決め（migration 20261111130000）', () => {
  it('一覧・詳細の本体は、お客様の氏名・会社名・連絡先・設置場所・備考・営業の記録を直接返さない（設置場所・現地確認は B-3 の専用の関数だけ）', () => {
    // 詳細の施工・製造の記録の資料（progress）の一覧は、資料の表から context = 'progress' だけを返す（下の試験）
    const progressFiles = "from public.case_files f where f.quote_request_id = p_request_id and f.context = 'progress'";
    for (const name of ['list_supervised_cases', 'get_supervised_case']) {
      const body = functionBody(name).replace(progressFiles, '');
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

  it('案件・見積の表の RLS は開かない（専用の関数だけで返す）。開くのは資料の読み取り（施工・製造の記録と現地確認の写真。B-3）だけ', () => {
    const policies = [...sqlOnly.matchAll(/(create|alter|drop) policy(?: if exists)? (\w+) on public\.(\w+)/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
    expect(policies).toEqual(['drop case_files_read case_files', 'create case_files_read case_files']);
    expect(migration).toContain('using (public.case_file_readable(quote_request_id, context, content_type, customer_visible));');
    // 判定は 1 行に case_role を 1 回。製造担当組織・配下の確認は施工・製造の記録と現地確認の写真（画像）だけ
    const readable = sqlOnly.slice(
      sqlOnly.indexOf('create function public.case_file_readable('),
      sqlOnly.indexOf('\n$$;', sqlOnly.indexOf('create function public.case_file_readable('))
    );
    expect(readable.split('public.case_role(').length - 1).toBe(1);
    expect(readable).toContain("when v_role in ('manufacturer', 'supervisor') then");
    expect(readable).toContain("p_context = 'progress'");
    expect(readable).toContain("(p_context = 'site_survey' and coalesce(p_content_type, '') like 'image/%')");
    expect(readable).toContain("(v_role = 'manufacturer' and public.is_case_legacy_manufacturer(p_request_id))");
    expect(readable).toContain("when v_role = 'customer' then coalesce(p_customer_visible, false)");
    expect(migration).toContain('grant execute on function public.case_file_readable(uuid, text, text, boolean) to authenticated;');
  });

  it('製造は、取り消し・下書きでない製造依頼と、その個体だけを返す（進み具合の数とそろえる）', () => {
    const detail = functionBody('get_supervised_case');
    expect(detail).toContain("where mo.quote_request_id = p_request_id and mo.status not in ('draft', 'canceled')");
    expect(detail).toContain('from public.manufacturing_units u where u.order_id = v_order.id');
    expect(detail).not.toContain('from public.manufacturing_units u where u.quote_request_id');
  });

  it('一覧は、権限を確かめた行の進み具合を内部の関数で求める（行ごとに読み取りの判定をやり直さない）', () => {
    expect(functionBody('list_supervised_cases')).toContain("'progress', public.case_progress_summary(w.quote_request_id)");
    expect(functionBody('list_supervised_cases')).not.toContain('get_case_progress');
    const progress = sqlOnly.slice(sqlOnly.indexOf('create or replace function public.get_case_progress('), sqlOnly.indexOf('\n$$;', sqlOnly.indexOf('create or replace function public.get_case_progress(')));
    expect(progress).toContain('if public.case_role(p_request_id) is null then');
    expect(progress).toContain('return public.case_progress_summary(p_request_id);');
    expect(migration).toContain('revoke all on function public.case_progress_summary(uuid) from public, anon, authenticated, service_role;');
    expect(sqlOnly).not.toMatch(/grant execute on function public\.case_progress_summary/);
  });

  it('総代理店に見せる、製造・出荷・施工に必要な情報（2026-11-04 の先方回答 B-3）：案件名・顧客番号・設置場所・条件・用途・現地確認だけ', () => {
    const body = functionBody('case_partner_site_info');
    for (const field of [
      "'case_name'", "'customer_no'", "'site_address'", "'land_status'", "'area_sqm'", "'land_category'", "'road_access'",
      "'electricity'", "'water'", "'drainage'", "'intended_use'", "'survey_notes'", "'legal'",
      "where f.quote_request_id = r.id and f.context = 'site_survey' and f.content_type like 'image/%'",
    ]) {
      expect(body, `${field} が無い`).toContain(field);
    }
    // お客様の氏名・会社名・電話・メール・ご自宅の住所・メッセージ、打合せの希望、土地なしの希望地域・予算・メモ、記録・契約は返さない
    for (const field of [
      'full_name', 'company_name', 'customer_name', 'customer_company', "'email'", "'phone'", "->> 'address'", 'r.message',
      'desired_area', 'land_budget', 'sp.note', 'case_notes', 'contracts', 'quote_request_preferences', "'document'", 'surveyor_name',
    ]) {
      expect(body, `${field} が含まれている`).not.toContain(field);
    }
    expect(functionBody('get_supervised_case')).toContain("'partner_info', public.case_partner_site_info(p_request_id)");
    // 内部の部品は利用者から呼べない
    expect(migration).toContain('revoke all on function public.case_partner_site_info(uuid) from public, anon, authenticated, service_role;');
    expect(sqlOnly).not.toMatch(/grant execute on function public\.case_partner_site_info/);
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
