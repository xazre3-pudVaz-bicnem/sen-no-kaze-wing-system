import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261014090000_unused_published_product_safe_delete.sql'),
  'utf8'
);
const action = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/unused-published-product-delete.ts'),
  'utf8'
);
const control = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/published-option-delete-control.tsx'),
  'utf8'
);
const layout = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/layout.tsx'), 'utf8');
const dbCheck = fs.readFileSync(path.resolve(process.cwd(), 'scripts/db-rehearsal/check.mjs'), 'utf8');
const runtimeSql = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/db-rehearsal/runtime-unused-published-option-delete.sql'),
  'utf8'
);

describe('登録済み未使用商品の安全削除', () => {
  it('DB RPCが認証・商品編集権限・published限定を強制する', () => {
    expect(migration).toContain('security definer');
    expect(migration).toContain('auth.uid() is null');
    expect(migration).toContain('public.can_edit_catalog()');
    expect(migration).toContain("v_option_status <> 'published'");
    expect(migration).toContain('for update');
  });

  it('保存済み仕様・見積・標準見積・履歴・商品ルール・Presetを参照確認する', () => {
    for (const table of [
      'public.configuration_items',
      'public.configurations',
      'public.configuration_snapshots',
      'public.quote_draft_items',
      'public.quote_items',
      'public.standard_estimate_revision_baseline_items',
      'public.estimate_templates',
      'public.legacy_migration_financial_snapshots',
      'public.quote_internal_snapshots',
      'public.option_dependencies',
      'public.option_conflicts',
      'public.base_models',
    ]) {
      expect(migration).toContain(table);
    }
    expect(migration).toContain('variant_choice_ids');
    expect(migration).toContain("preset.value -> 'option_codes'");
  });

  it('JSON/配列参照の確認中は対象テーブルの書込み競合を防ぐ', () => {
    expect(migration).toContain('lock table');
    expect(migration).toContain('in share mode;');
    expect(migration).toContain('public.configuration_items');
    expect(migration).toContain('public.configuration_snapshots');
    expect(migration).toContain('public.estimate_templates');
    expect(migration).toContain('public.quote_internal_snapshots');
  });

  it('publishedの通常RLS DELETEを閉じ、RPC実行権限をauthenticatedに限定する', () => {
    expect(migration).toContain('as restrictive');
    expect(migration).toContain("using (status = 'draft');");
    expect(migration).toContain('revoke all on function public.delete_unused_published_option(uuid) from public;');
    expect(migration).toContain('revoke all on function public.delete_unused_published_option(uuid) from service_role;');
    expect(migration).toContain('grant execute on function public.delete_unused_published_option(uuid) to authenticated;');
  });

  it('Server Actionも商品編集権限を要求し、本番では安全削除RPCだけを呼ぶ', () => {
    expect(action).toContain('await requireCatalogEditor();');
    expect(action).toContain("option.status !== 'published'");
    expect(action).toContain("db.rpc('delete_unused_published_option'");
    expect(action).toContain("error.code === 'PGRST202'");
  });

  it('登録済み商品の削除UIは商品編集権限がある場合だけ有効化される', () => {
    expect(control).toContain('登録済み商品の削除（未使用のみ）');
    expect(control).toContain('この商品を削除');
    expect(layout).toContain('<PublishedOptionDeleteControl enabled={canEditCatalog(user.role)} />');
  });

  it('DB Rehearsalで権限・未使用削除・使用中拒否・published直DELETE拒否・draft削除維持を実動作確認する', () => {
    expect(dbCheck).toContain('runtimeUnusedPublishedOptionDelete');
    expect(runtimeSql).toContain('anonはRPCを実行できない');
    expect(runtimeSql).toContain('dealerはRPCで削除できない');
    expect(runtimeSql).toContain('adminは未使用publishedを削除できる');
    expect(runtimeSql).toContain('商品ルールで使用中ならRPCは削除を拒否する');
    expect(runtimeSql).toContain('published直接DELETEはRLSで0行');
    expect(runtimeSql).toContain('既存のdraft直接DELETEは維持する');
    expect(runtimeSql).toContain('rollback;');
  });
});
