import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const migration = read('supabase/migrations/20261016200000_option_standard_cost_versions.sql');
const data = read('lib/data/option-hq-standard-cost.ts');
const card = read('components/admin/option-hq-standard-cost-card.tsx');
const optionPage = read('app/admin/options/[id]/page.tsx');
const check = read('scripts/db-rehearsal/check.mjs');
const runtimeSql = read('scripts/db-rehearsal/runtime-option-standard-cost-versions.sql');
const runtimeRace = read('scripts/db-rehearsal/runtime-option-standard-cost-versions.mjs');

const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

function functionBody(name: string) {
  const start = sqlOnly.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(0);
  const bodyStart = sqlOnly.indexOf('as $$', start);
  const bodyEnd = sqlOnly.indexOf('$$;', bodyStart + 5);
  return sqlOnly.slice(start, bodyEnd);
}

describe('v2.5 PR-A1：標準原価の Version', () => {
  it('1 つの transaction で適用し、lock を長く待たず、前提を確かめてから作る', () => {
    expect(sqlOnly.trimStart().startsWith('begin;')).toBe(true);
    expect(sqlOnly.trimEnd().endsWith('commit;')).toBe(true);
    expect(sqlOnly).toContain("set local lock_timeout = '5s';");
    expect(sqlOnly).toContain("to_regprocedure('public.set_option_hq_standard_cost(uuid, integer, integer, text)') is null");
    expect(sqlOnly).toContain("to_regclass('public.option_standard_cost_versions') is not null");
  });

  it('商品の標準原価とバリエーションの調整額を、それぞれ Version の表で持つ（商品・選択肢の削除は RESTRICT）', () => {
    expect(sqlOnly).toContain('create table public.option_standard_cost_versions');
    expect(sqlOnly).toContain('option_id uuid not null references public.options(id) on delete restrict');
    expect(sqlOnly).toContain('standard_cost integer not null check (standard_cost >= 0)');
    expect(sqlOnly).toContain('unique (option_id, version_no)');
    expect(sqlOnly).toContain('create table public.option_variant_cost_versions');
    expect(sqlOnly).toContain('variant_choice_id uuid not null references public.option_variant_choices(id) on delete restrict');
    // 調整額はプラス・0・マイナスを持てる
    expect(sqlOnly).toContain('cost_adjustment integer not null check (cost_adjustment between -100000000 and 100000000)');
    expect(sqlOnly).toContain('unique (variant_choice_id, version_no)');
  });

  it('現在有効な Version は同じ対象に 1 つだけ（部分一意 index）', () => {
    expect(sqlOnly).toMatch(/create unique index option_standard_cost_versions_current_key\s+on public\.option_standard_cost_versions \(option_id\)\s+where superseded_at is null;/);
    expect(sqlOnly).toMatch(/create unique index option_variant_cost_versions_current_key\s+on public\.option_variant_cost_versions \(variant_choice_id\)\s+where superseded_at is null;/);
    expect(sqlOnly).toContain('check ((superseded_at is null) = (superseded_by_version_id is null))');
  });

  it('作った Version は変えられない：閉じる 1 回だけを許し、削除は拒否する', () => {
    const trigger = functionBody('standard_cost_version_immutable');
    expect(trigger).toContain("if tg_op = 'DELETE' then");
    expect(trigger).toContain("'LOCKED: 標準原価の Version は削除できません");
    expect(trigger).toContain('old.superseded_at is not null');
    expect(trigger).toContain("- 'superseded_at' - 'superseded_by_version_id'");
    expect(sqlOnly).toContain('before update or delete on public.option_standard_cost_versions');
    expect(sqlOnly).toContain('before update or delete on public.option_variant_cost_versions');
  });

  it('Version の表は本部だけが読め、書き込みは RPC だけ', () => {
    for (const table of ['option_standard_cost_versions', 'option_variant_cost_versions']) {
      expect(sqlOnly).toContain(`alter table public.${table} enable row level security;`);
      expect(sqlOnly).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role;`);
      expect(sqlOnly).toContain(`grant select on table public.${table} to authenticated;`);
      expect(sqlOnly).not.toMatch(new RegExp(`grant\\s+(insert|update|delete|truncate|all)[^;]*on\\s+table\\s+public\\.${table}`, 'i'));
    }
    expect((sqlOnly.match(/using \(public\.can_view_option_hq_standard_cost\(\)\);/g) ?? []).length).toBe(2);
  });

  it('既存の本部商品基準原価は現在の Version の写しにし、既存の値は Version 1 として移す', () => {
    expect(sqlOnly).toContain('add column current_version_id uuid references public.option_standard_cost_versions(id) on delete restrict');
    expect(sqlOnly).toContain('alter column current_version_id set not null');
    expect(sqlOnly).toContain('create unique index option_hq_standard_costs_current_version_key');
    expect(sqlOnly).toMatch(/insert into public\.option_standard_cost_versions \(option_id, version_no, standard_cost, change_reason, created_by, created_at\)\s+select c\.option_id, 1, c\.standard_cost/);
    // 既存の migration と公開商品の表は変えない
    expect(sqlOnly).not.toMatch(/alter\s+table\s+public\.(options|quotes|quote_items|quote_drafts|standard_estimate_\w+)\b/i);
  });

  it('本部商品基準原価の設定 RPC は呼び方を変えずに、新しい Version を作る', () => {
    const fn = functionBody('set_option_hq_standard_cost');
    expect(sqlOnly).toContain('create or replace function public.set_option_hq_standard_cost(');
    expect(fn).toContain('p_expected_lock_version integer');
    // lock の順：商品 → 写し → 現在の Version（商品削除・調整額の RPC と同じく商品を先に）
    const optionLock = fn.indexOf('from public.options o');
    const mirrorLock = fn.indexOf('from public.option_hq_standard_costs c');
    const versionLock = fn.indexOf('from public.option_standard_cost_versions v\n  where v.option_id = p_option_id\n    and v.superseded_at is null\n  for update;');
    expect(optionLock).toBeGreaterThan(0);
    expect(mirrorLock).toBeGreaterThan(optionLock);
    expect(versionLock).toBeGreaterThan(mirrorLock);
    // 版が古ければ Version を作らずに止め、同額は no-op
    expect(fn.indexOf("'CONFLICT: 本部商品基準原価が他の担当者によって変更されています")).toBeLessThan(fn.indexOf('insert into public.option_standard_cost_versions'));
    expect(fn.indexOf('return query select v_current.option_id, v_current.standard_cost, v_current.lock_version, false')).toBeLessThan(
      fn.indexOf('insert into public.option_standard_cost_versions')
    );
    // 現在の Version を閉じてから新しい Version を作り、写しを同じ transaction で更新する
    expect(fn.indexOf('set superseded_at = now(),')).toBeLessThan(fn.indexOf('insert into public.option_standard_cost_versions'));
    expect(fn).toContain('lock_version = c.lock_version + 1');
    expect(fn).toContain('current_version_id = v_new_id');
    expect(fn).toContain("'version_no', v_new_version.version_no");
    expect(fn).not.toMatch(/on\s+conflict/i);
  });

  it('どの組み合わせでも適用後の標準原価を 0 円未満にしない（商品の原価・調整額の両方の RPC で確かめる）', () => {
    const minTotal = functionBody('option_variant_cost_min_total');
    expect(minTotal).toContain('least(min(case when vc.id = p_choice_id then p_adjustment else coalesce(v.cost_adjustment, 0) end), 0)');
    expect(minTotal).not.toContain('security definer');
    expect(functionBody('set_option_hq_standard_cost')).toContain('if p_standard_cost + public.option_variant_cost_min_total(p_option_id) < 0 then');
    expect(functionBody('set_option_variant_cost_adjustment')).toContain(
      'v_product_cost + public.option_variant_cost_min_total(v_option_id, p_variant_choice_id, p_cost_adjustment) < 0'
    );
  });

  it('調整額の設定 RPC は本部の管理権限だけ・商品の行を lock・期待した Version と一致したときだけ変える', () => {
    const fn = functionBody('set_option_variant_cost_adjustment');
    expect(fn).toContain('v_actor uuid := auth.uid();');
    expect(fn).toContain('if not public.can_manage_option_hq_standard_cost() then');
    expect(fn).toMatch(/from public\.options o\s+where o\.id = v_option_id\s+for update;/);
    expect(fn).toContain('if p_expected_current_version_id is distinct from (case when v_has_current then v_current.id end) then');
    expect(fn).toContain("'variant_standard_cost_update'");
    expect(fn).toContain("'variant_standard_cost_set'");
    expect(fn).toContain("'change_reason', v_reason");
  });

  it('関数は postgres 所有・空の search_path。RPC だけを authenticated に開け、内部の関数は開けない', () => {
    expect(sqlOnly).toContain('grant execute on function public.set_option_hq_standard_cost(uuid, integer, integer, text) to authenticated;');
    expect(sqlOnly).toContain('grant execute on function public.set_option_variant_cost_adjustment(uuid, integer, uuid, text) to authenticated;');
    expect(sqlOnly).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.option_variant_cost_min_total/i);
    expect(sqlOnly).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.standard_cost_version_immutable/i);
    for (const fn of ['standard_cost_version_immutable()', 'option_variant_cost_min_total(uuid, uuid, integer)',
      'set_option_hq_standard_cost(uuid, integer, integer, text)', 'set_option_variant_cost_adjustment(uuid, integer, uuid, text)']) {
      expect(sqlOnly).toContain(`alter function public.${fn} owner to postgres;`);
      expect(sqlOnly).toContain(`revoke all on function public.${fn} from public, anon, authenticated, service_role;`);
    }
    expect((sqlOnly.match(/set search_path = ''/g) ?? []).length).toBe(4);
  });

  it('画面は現在の版と変更履歴を出し、Version の表が未適用でも現在値の表示・変更を壊さない', () => {
    expect(data).toContain(".from('option_standard_cost_versions')");
    expect(data).toContain("versionResult.error && !migrationUnavailable(versionResult.error)");
    expect(data).toContain('versions: versionResult.error ? null :');
    expect(card).toContain('data-testid="option-hq-standard-cost-history"');
    expect(card).toContain('data-testid="option-hq-standard-cost-version"');
    expect(card).toContain('過去の版は書き換えません');
    expect(card).not.toContain(' ／ version ');
    // カードを出す場所（登録済みの編集・閲覧だけ・下書きの登録）のすべてで、Version の一覧を渡す
    const cardUses = (optionPage.match(/<OptionHqStandardCostCard\b/g) ?? []).length;
    expect(cardUses).toBeGreaterThan(0);
    expect((optionPage.match(/versions=\{hqCostAccess\.versions\}/g) ?? []).length).toBe(cardUses);
  });

  it('実 DB の検査（1 接続・2 接続の競合）を check.mjs に登録し、1 接続の検査は rollback する', () => {
    expect(check).toContain("import { runtimeOptionStandardCostVersions } from './runtime-option-standard-cost-versions.mjs';");
    expect(check).toContain('await runtimeOptionStandardCostVersions(client, { connectionString: url })');
    expect(runtimeSql.trimEnd().endsWith('rollback;')).toBe(true);
    expect(runtimeRace).toContain('waitUntilBlocked');
    expect(runtimeRace).toContain('cleanupRaceFixture');
  });
});
