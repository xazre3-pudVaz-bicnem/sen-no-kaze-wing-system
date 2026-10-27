import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LocalDb } from '@/lib/data/local-db';
import { selectableOrganizationOfMember } from '@/lib/data/organizations/local-relations';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261016160000_customer_selects_dealer_organization.sql'), 'utf8');

describe('お客様が代理店を選ぶ：DB の取り決め（migration 20261016160000）', () => {
  it('紹介ページの代理店が所属する、有効で管理者がいる代理店・総代理店を営業担当の候補にする（組織の指定があればそちらを使う）', () => {
    const derive = migration.slice(migration.indexOf('if v_org is null and v_dealer is not null then'), migration.indexOf("v_method := public.cf_text(p_preferences, 'meeting_method'"));
    expect(derive).toContain('where m.profile_id = v_dealer');
    expect(derive).toContain("and m.status = 'active'");
    expect(derive).toContain("and o.status = 'active'");
    expect(derive).toContain("and o.organization_type in ('master_dealer', 'dealer')");
    expect(derive).toContain("mm.member_role in ('owner', 'admin')");
  });

  it('営業担当を決めたときは「担当代理店を割り当てて」を本部に送らない（決めなかったときは従来どおり送る）', () => {
    expect(migration).toContain('v_assigned := true;');
    expect(migration).toContain('if v_dealer is not null and v_dealer is distinct from v_before and not v_assigned then');
    expect(migration.indexOf("'case_preferred_dealer'")).toBeGreaterThan(migration.indexOf('v_assigned := true;'));
  });

  it('実行はログインした利用者だけ（関数の中で、ご依頼のお客様と本部だけを通す）', () => {
    expect(migration).toContain('grant execute on function public.set_quote_request_preferences(uuid, jsonb) to authenticated;');
    expect(migration).toContain("if v_access is null or v_access not in ('customer', 'admin') then");
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
