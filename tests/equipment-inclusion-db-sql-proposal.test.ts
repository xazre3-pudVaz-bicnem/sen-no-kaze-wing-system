import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 静的チェックだけ。DBの実行時検証・RLS検証・独立レビューを代替しない。
const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261110024245_option_included_categories.sql'),
  'utf8',
);
const executable = sql.replace(/--[^\n]*/g, '');

describe('設備包含DB/RPC migration（静的ガード：runtimeの代用ではない）', () => {
  it('Supabase CLIで生成された新規migrationが正式な格納先にあり、本番未適用であることを区別する', () => {
    expect(sql).toContain('NEW MIGRATION');
    expect(sql).toContain('requires independent review');
  });

  it('複合主キー・商品削除時CASCADE・カテゴリー削除時RESTRICT・RLSを宣言する', () => {
    expect(sql).toContain('option_included_categories_pkey primary key (option_id, included_category_id)');
    expect(sql).toMatch(/option_id uuid not null references public\.options \(id\) on delete cascade/i);
    expect(sql).toMatch(/included_category_id uuid not null references public\.option_categories \(id\) on delete restrict/i);
    expect(sql).toMatch(/alter table public\.option_included_categories enable row level security/i);
    expect(sql).toMatch(/create policy option_included_categories_read[\s\S]*?for select to anon, authenticated/i);
  });

  it('anon等の直接writeを剥奪し、RPCはauthenticatedだけに公開する', () => {
    expect(sql).toMatch(/revoke all on table public\.option_included_categories\s+from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function public\.set_option_included_categories\(uuid,uuid\[\],uuid\[\]\)\s+from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.set_option_included_categories\(uuid,uuid\[\],uuid\[\]\)\s+to authenticated/i);
    expect(sql).toMatch(/has_table_privilege\('service_role', 'public\.option_included_categories', 'INSERT'\)/i);
  });

  it('SECURITY DEFINERの権限・search_path・行ロック・期待集合競合を備える', () => {
    expect(sql).toMatch(/security definer\s+set search_path = ''\s+set lock_timeout = '2s'/i);
    expect(sql).toMatch(/auth\.uid\(\) is null/i);
    expect(sql).toMatch(/not public\.can_edit_catalog\(\)/i);
    expect(sql).toMatch(/for update of o;/i);
    expect(sql).toMatch(/v_current is distinct from v_expected/i);
    expect(sql).toMatch(/perform public\.write_audit\(/i);
  });

  it('設備包含の変更と非公開関係の閲覧は本部rank3以上に限定する', () => {
    expect(sql).toContain('public.current_role_rank() >= 3');
    expect(sql).toContain('public.current_role_rank() < 3');
    expect(sql).toContain('not public.can_edit_catalog()');
  });

  it('商品カテゴリーの後続変更でも自己包含のDB不変条件を守る', () => {
    expect(sql).toContain('create function public.guard_option_inclusion_category_change()');
    expect(sql).toContain('before update of category_id on public.options');
    expect(sql).toContain('where rel.option_id = new.id');
    expect(sql).toContain('options_inclusion_category_change_guard');
    expect(sql).toContain('revoke all on function public.guard_option_inclusion_category_change()');
  });

  it('包含元はub、包含先はtoiletとwashbasinのみ（個別設定）', () => {
    expect(sql).toContain("v_option_category_code is distinct from 'ub'");
    expect(sql).toContain("c.code not in ('toilet', 'washbasin')");
    expect(sql).toContain('unnest(v_next)');
    expect(sql).not.toContain("group_code <> 'equipment'");
  });

  it('旧見積・Published・Snapshot・商品間排他にはDMLを実行しない', () => {
    const destructive = /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:option_conflicts|standard_estimate_\w+|quote_\w+|quotes|configuration_snapshots)\b/i;
    expect(executable).not.toMatch(destructive);
    expect(executable).toMatch(/delete from public\.option_included_categories/i);
    expect(executable).toMatch(/insert into public\.option_included_categories/i);
  });

  it('初期テーブルにデータ投入はせず、単一トランザクションだけを提案する', () => {
    expect(executable.match(/^\s*begin;\s*$/gm)).toHaveLength(1);
    expect(executable.match(/^\s*commit;\s*$/gm)).toHaveLength(1);
    expect(executable.match(/create table public\./g)).toHaveLength(1);
  });
});
