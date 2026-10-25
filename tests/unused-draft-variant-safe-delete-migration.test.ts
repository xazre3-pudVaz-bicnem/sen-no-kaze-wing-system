import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261025101000_unused_draft_variant_safe_delete.sql'),
  'utf8',
);
const ui = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-variant-manager.tsx'),
  'utf8',
);
const action = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/unused-draft-variant-delete.ts'),
  'utf8',
);

describe('未使用の下書きバリエーションだけを安全に削除するDB境界', () => {
  it('2種類のRPCが本人確認・編集権限・下書き・既存参照guardを要求する', () => {
    expect(sql).toContain('public.delete_unused_variant_choice(');
    expect(sql).toContain('public.delete_unused_variant_group(');
    const functions = sql.split('create or replace function public.delete_unused_variant_').slice(1, 3);
    expect(functions).toHaveLength(2);
    for (const f of functions) {
      expect(f).toContain('security definer');
      expect(f).toContain("set search_path = ''");
      expect(f).toContain("set lock_timeout = '2s'");
      expect(f).toContain('auth.uid() is null');
      expect(f).toContain('public.can_edit_catalog()');
      expect(f).toContain("o.status = 'draft'");
      expect(f).toContain('for update');
      expect(f).toContain('perform public.assert_option_unreferenced(p_option_id, v_option_code)');
      expect(f).toContain('exception\n  when lock_not_available or deadlock_detected then');
    }
  });

  it('他の項目の条件に使われたgroup/codeを消さない', () => {
    expect(sql).toContain('child.depends_on_group_code = v_group_code');
    expect(sql).toContain('v_choice_code = any(coalesce(child.depends_on_choice_codes');
    expect(sql).toContain('child.id <> p_group_id');
    expect(sql).toContain('child.id <> v_group_id');
  });

  it('直接DELETEは禁止。RPCのEXECUTEはauthenticatedにだけ明示許可する', () => {
    expect(sql).toContain('revoke delete, truncate on table public.option_variant_groups');
    expect(sql).toContain('revoke delete, truncate on table public.option_variant_choices');
    expect(sql).toContain('grant execute on function public.delete_unused_variant_choice(uuid, uuid) to authenticated');
    expect(sql).toContain('grant execute on function public.delete_unused_variant_group(uuid, uuid) to authenticated');
    expect(sql).toContain("has_table_privilege('service_role', 'public.option_variant_choices', 'DELETE')");
  });

  it('Server Actionはサーバー権限、所属を確認し、RPCなし・エラー時は削除を拒否', () => {
    expect(action).toContain('await requireCatalogEditor()');
    expect(action).toContain("option.status !== 'draft'");
    expect(action).toContain('c.group_id === groupId');
    expect(action).toContain("code === 'PGRST202'");
    expect(action).toContain('isDemoFallback() || isLocalMode()');
    expect(action).not.toContain(".from('option_variant_choices').delete()");
    expect(action).not.toContain(".from('option_variant_groups').delete()");
    expect(ui).toContain('deleteUnusedDraftVariantAction');
    expect(ui).toContain('ConfirmSubmit');
  });

  // SQLの実行時・競合・権限・Snapshot破壊の確認は実Postgresで別途必要。
});
