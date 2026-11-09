import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LocalDb } from '@/lib/data/local-db';
import { selectableOrganizationOfMember } from '@/lib/data/organizations/local-relations';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261104160000_customer_selects_dealer_organization.sql'), 'utf8');
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const functionBody = (name: string) => {
  const start = sqlOnly.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  return sqlOnly.slice(start, sqlOnly.indexOf('\n$$;', start));
};

describe('お客様が代理店を選ぶ：DB の取り決め（migration 20261104160000）', () => {
  it('紹介ページの代理店が所属する、有効で管理者がいる代理店・総代理店だけを営業担当の候補にする', () => {
    const selectable = functionBody('selectable_dealer_organization');
    expect(selectable).toContain('where m.profile_id = p_dealer_id');
    expect(selectable).toContain("and m.status = 'active'");
    expect(selectable).toContain("and o.status = 'active'");
    expect(selectable).toContain("and o.organization_type in ('master_dealer', 'dealer')");
    expect(selectable).toContain("mm.member_role in ('owner', 'admin')");
    // 見積依頼の画面の候補も同じ判定
    expect(functionBody('list_selectable_dealer_ids')).toContain('public.selectable_dealer_organization(d.dealer_id) is not null');
  });

  it('営業担当組織を決めるのは、お客様本人が見積依頼の直後に初めて希望を保存したときだけ。手の付いた案件は決めない', () => {
    const fn = functionBody('set_quote_request_preferences');
    expect(fn).toContain("if v_dealer is not null and v_access = 'customer' and not v_had_preferences");
    expect(fn).toContain("and v_request.created_at >= pg_catalog.now() - interval '1 hour' then");
    expect(fn).toContain('v_had_preferences := found;');
    for (const condition of [
      'w.sales_organization_id is null',
      'w.sales_assigned_at is null',
      'w.acknowledged_at is null',
      'w.primary_staff_id is null',
      'q.dealer_id is not null',
      'from public.contracts c',
      'from public.manufacturing_orders o',
    ]) {
      expect(fn, `${condition} が無い`).toContain(condition);
    }
    // 案件の行をロックしてから確かめる
    expect(fn).toContain('select * into w from public.case_workflows cw where cw.quote_request_id = p_request_id for update;');
  });

  it('組織を直接指定させず、選んだ代理店は公開中で設置予定地に対応していること', () => {
    const fn = functionBody('set_quote_request_preferences');
    expect(fn).toContain("if p_preferences ? 'preferred_organization_id' then");
    expect(fn).toContain('if not public.dealer_serves_area(v_dealer, v_prefecture, v_municipality) then');
    expect(sqlOnly).not.toContain('preferred_organization_id uuid');
    expect(sqlOnly).not.toMatch(/preferred_organization_id\s*=\s*excluded/);
    const area = functionBody('dealer_serves_area');
    expect(area).toContain('p_prefecture = any (d.service_prefectures)');
    expect(area).toContain("(p_prefecture || '/' || p_municipality) = any (d.service_municipalities)");
  });

  it('決めたときは監査ログを残し、組織の管理者・製造担当組織の管理者・本部へ知らせる。決めなかったときは従来どおり本部へ', () => {
    const fn = functionBody('set_quote_request_preferences');
    expect(fn).toContain("perform public.write_case_audit(p_request_id, 'case_sales_organization'");
    expect(fn).toContain("perform public.notify_organization_managers(v_org, 'case_sales_assigned'");
    expect(fn).toContain("perform public.notify_organization_managers(v_mfg, 'case_manufacturer_assigned'");
    expect(fn).toContain('v_assigned := true;');
    expect(fn).toContain('if v_dealer is not null and v_dealer is distinct from v_before and not v_assigned then');
    expect(fn.indexOf("'case_preferred_dealer'")).toBeGreaterThan(fn.indexOf('v_assigned := true;'));
  });

  it('実行はログインした利用者だけ（関数の中で、ご依頼のお客様と本部だけを通す）。内部の判定は利用者から呼べない', () => {
    expect(migration).toContain('grant execute on function public.set_quote_request_preferences(uuid, jsonb) to authenticated;');
    expect(migration).toContain('grant execute on function public.list_selectable_dealer_ids() to authenticated;');
    expect(functionBody('set_quote_request_preferences')).toContain("if v_access is null or v_access not in ('customer', 'admin') then");
    expect(migration).toContain('revoke all on function public.dealer_serves_area(uuid, text, text) from public, anon, authenticated, service_role;');
    expect(migration).toContain('revoke all on function public.selectable_dealer_organization(uuid) from public, anon, authenticated, service_role;');
    expect(sqlOnly).not.toMatch(/grant execute on function public\.(dealer_serves_area|selectable_dealer_organization)/);
  });
});

describe('お客様が代理店を選ぶ：ローカル検証モードの判定', () => {
  const org = (id: string, organization_type: string, status = 'active') => ({ id, organization_type, status, name: id, parent_organization_id: null });
  const member = (organization_id: string, profile_id: string, member_role: string, status = 'active') => ({
    id: `${organization_id}-${profile_id}`,
    organization_id,
    profile_id,
    member_role,
    status,
  });
  const db = {
    organizations: {
      organizations: [org('d', 'dealer'), org('nomgr', 'dealer'), org('stopped', 'dealer', 'inactive'), org('hq', 'headquarters')],
      memberships: [
        member('d', 'manager', 'admin'),
        member('d', 'staff', 'editor'),
        member('nomgr', 'lonely', 'editor'),
        member('stopped', 'stopped-manager', 'admin'),
        member('hq', 'hq-user', 'admin'),
        member('d', 'left', 'editor', 'inactive'),
      ],
      invitations: [],
    },
  } as unknown as LocalDb;

  it('管理者がいる有効な代理店のメンバーなら、その組織', () => {
    expect(selectableOrganizationOfMember(db, 'staff')).toBe('d');
    expect(selectableOrganizationOfMember(db, 'manager')).toBe('d');
  });

  it('組織に所属していない・管理者のいない組織・停止中の組織・本部・所属を外れた人は候補にしない', () => {
    expect(selectableOrganizationOfMember(db, 'nobody')).toBeNull();
    expect(selectableOrganizationOfMember(db, 'lonely')).toBeNull();
    expect(selectableOrganizationOfMember(db, 'stopped-manager')).toBeNull();
    expect(selectableOrganizationOfMember(db, 'hq-user')).toBeNull();
    expect(selectableOrganizationOfMember(db, 'left')).toBeNull();
  });
});
