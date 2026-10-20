import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261016150000_manufacturing_cases.sql'), 'utf8');
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const functionBody = (name: string) => {
  const start = sqlOnly.indexOf(`create function public.${name}(`);
  return sqlOnly.slice(start, sqlOnly.indexOf('\n$$;', start));
};
const actions = fs.readFileSync(path.join(root, 'lib/actions/case-flow.ts'), 'utf8');
const productionPanels = fs.readFileSync(path.join(root, 'components/case-flow/case-production-panels.tsx'), 'utf8');
const handoverPanels = fs.readFileSync(path.join(root, 'components/case-flow/case-handover-panels.tsx'), 'utf8');

describe('製造担当の案件：DB の取り決め（migration 20261016150000）', () => {
  it('お客様の情報・見積の金額と備考・営業の記録を返さない', () => {
    for (const name of ['manufacturing_case_row', 'list_manufacturing_cases', 'get_manufacturing_case']) {
      const body = functionBody(name);
      expect(body.length).toBeGreaterThan(200);
      for (const field of [
        'customer_name',
        'customer_company',
        'customer_note',
        'dealer_note',
        'adjustment_reason',
        'unit_price',
        'amount',
        'total',
        'subtotal',
        'site_address',
        'configuration_site_profiles',
        'site_surveys',
        'case_notes',
        'case_files',
        'quote_request_preferences',
        'email',
        'phone',
      ]) {
        expect(body, `${name} に ${field} が含まれている`).not.toContain(field);
      }
      expect(body).not.toMatch(/'notes'|\.notes\b/);
    }
  });

  it('詳細は本部と製造の担当（case_access の manufacturer）だけ。一覧は所属している製造担当組織か自分あての案件に絞ってから同じ規則で確かめる', () => {
    const detail = functionBody('get_manufacturing_case');
    expect(detail).toContain("v_access not in ('admin', 'manufacturer')");
    expect(detail).toContain("errcode = '42501'");
    const list = functionBody('list_manufacturing_cases');
    expect(list).toContain("om.profile_id = v_uid and om.status = 'active'");
    expect(list).toContain('w.manufacturing_organization_id is null and w.manufacturer_id = v_uid');
    expect(list).toContain("public.case_access(w.quote_request_id) = 'manufacturer'");
  });

  it('1 件分の行を作る関数は内部用。画面から呼べるのはログインした利用者だけ', () => {
    expect(migration).toContain('revoke all on function public.manufacturing_case_row(uuid) from public, anon, authenticated, service_role;');
    expect(migration).not.toMatch(/grant execute on function public\.manufacturing_case_row/);
    expect(migration).toContain('grant execute on function public.list_manufacturing_cases() to authenticated;');
    expect(migration).toContain('grant execute on function public.get_manufacturing_case(uuid) to authenticated;');
    expect(sqlOnly).not.toMatch(/create policy|alter policy|drop policy/);
  });
});

describe('製造担当の画面と、営業担当組織の管理者の読み取り専用表示', () => {
  it('製造の操作の戻り先は、案件画面・製造担当の画面（/admin/manufacturing/[案件]）・製造の一覧だけ', () => {
    expect(actions).toContain('function productionBack(formData: FormData, query: string)');
    expect(actions).toContain('/^\\/admin\\/manufacturing\\/[0-9a-f-]{36}$/i.test(back)');
    expect(actions).not.toContain('productionBack(quoteId,');
  });

  it('製造・施工と引渡しのタブは、営業担当組織の管理者に読み取りだけで出す（書き込みのフォームは出さない）', () => {
    for (const source of [productionPanels, handoverPanels]) {
      expect(source).toContain("(await caseFlow.getCaseRole(actor, requestId)) === 'manager'");
      expect(source).toContain("const canOperate = !readOnly && (access === 'admin' || access === 'staff');");
    }
    expect(productionPanels).toContain('!readOnly && canChangeOrderStatus(access, order.status, step.to)');
    expect(productionPanels).toContain("const editable = !readOnly && (access !== 'manufacturer'");
    expect(handoverPanels).toContain("!readOnly && canSetPunchItemStatus(access, item.status, 'fixed')");
    expect(handoverPanels).toContain('!readOnly && canUpdateAfterService(access, row, row.status)');
  });
});
