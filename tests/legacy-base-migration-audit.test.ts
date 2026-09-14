import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260914170000_legacy_base_migration_audit.sql'),
  'utf8'
);
const estimateImportMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260911020000_estimate_templates.sql'),
  'utf8'
);
const actions = readFileSync(join(process.cwd(), 'lib/actions/base-migration.ts'), 'utf8');
const page = readFileSync(join(process.cwd(), 'app/admin/base-migration/page.tsx'), 'utf8');
const adminLayout = readFileSync(join(process.cwd(), 'app/admin/layout.tsx'), 'utf8');
const proxy = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8');

describe('旧本体内訳の移行監査基盤', () => {
  it('監査PRでは旧正本や新本体へ実移行書込みをしない', () => {
    expect(migration).not.toMatch(/insert\s+into\s+public\.base_masters/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.base_master_revisions/i);
    expect(migration).not.toMatch(/update\s+public\.base_breakdown_items/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.base_breakdown_items/i);
    expect(migration).not.toMatch(/update\s+public\.estimate_templates/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.estimate_templates/i);
  });

  it('移行元hashは旧4テーブルとbaselineを固定する', () => {
    expect(migration).toContain('legacy_base_migration_source_hash');
    expect(migration).toContain("'sha256'");
    expect(migration).toContain("'base_breakdown_items'");
    expect(migration).toContain("'estimate_templates'");
    expect(migration).toContain("'estimate_template_sections'");
    expect(migration).toContain("'estimate_template_lines'");
    expect(migration).toContain("'baseline_option_ids'");
    expect(migration).toContain("'imported_at'");
  });

  it('移行監査用SQL関数のdollar quoteが開閉で一致する', () => {
    expect((migration.match(/\$\$/g) ?? []).length % 2).toBe(0);
    expect(migration).not.toContain('\n$;\n');
    expect((migration.match(/\$hashfn\$/g) ?? []).length).toBe(2);
    expect((migration.match(/\$assertfn\$/g) ?? []).length).toBe(2);
    expect((migration.match(/\$classifier\$/g) ?? []).length).toBe(2);
    expect((migration.match(/\$sig\$/g) ?? []).length).toBe(2);
    expect((migration.match(/\$locksrc\$/g) ?? []).length).toBe(2);
    expect((migration.match(/\$specmap\$/g) ?? []).length).toBe(2);
    expect((migration.match(/\$dupresolve\$/g) ?? []).length).toBe(2);
  });

  it('自動分類はsection＋品名の完全一致だけに限定する', () => {
    expect(migration).not.toContain('v_name like');
    expect(migration).not.toContain('v_section like');
    expect(migration).toContain("v_section = '２．プレカット'");
    expect(migration).toContain("'・204材l=12f'");
    expect(migration).toContain("'・天井ラワンべニア4㎜'");
    expect(migration).toContain("'・床用ミラフォーム90㎜'");
    expect(migration).toContain("v_remark = '屋根タルキ'");
    expect(migration).not.toContain("'・大型丁番＋ステンレス長ビス'");
    expect(migration).not.toContain("'・ジャッキベース'");
    expect(migration).toContain("'review'::text");
    expect(migration).toContain('section・品名・備考を人間が確認する');
  });

  it('4分類すべてを監査先として保存できる', () => {
    expect(migration).toContain("('base', 'interior_exterior', 'option', 'sitework', 'review')");
    expect(actions).toContain("z.enum(['base', 'interior_exterior', 'option', 'sitework', 'review'])");
    expect(page).toContain('<option value="sitework">別途</option>');
    expect(page).toContain("sitework: '別途'");
    expect(migration).toContain("m.target_classification in ('interior_exterior', 'option', 'sitework')");
    expect(migration).toContain('l.section_code = m.target_classification');
  });

  it('同一本体グループはsectionを含むBOMと本体諸費用条件を比較する', () => {
    expect(migration).toContain("'section', lower(btrim(m.legacy_section))");
    expect(migration).toContain('legacy_base_spec_body_signature');
    expect(migration).toContain('legacy_base_expense_rate is distinct from');
    expect(migration).toContain('legacy_base_expense is distinct from');
    expect(migration).toContain('legacy_base_total is distinct from');
    expect(migration).toContain('本体諸費用条件の異なる旧仕様');
  });

  it('レビュー確定は不足snapshotと金額再計算差も止める', () => {
    expect(migration).toContain('移行元データがレビュー開始後に変更されています');
    expect(migration).toContain('未確認の旧本体明細があります');
    expect(migration).toContain('旧仕様から新本体への対応が未確認です');
    expect(migration).toContain('未解決の二重計上候補があります');
    expect(migration).toContain('標準見積または移行前金額が不足している旧仕様があります');
    expect(migration).toContain('新本体Revisionで1円単位に完全保存できない旧本体諸費用があります');
    expect(migration).toContain('本体に残す旧明細の金額が単価×数量の再計算結果と一致しません');
    expect(migration).toContain('旧標準見積の内部金額に不整合があります');
  });

  it('旧正本ロックはExcel取込と同じestimate_templates先頭順序にする', () => {
    const importTemplateDelete = estimateImportMigration.indexOf('delete from public.estimate_templates');
    const importBaseDelete = estimateImportMigration.indexOf('delete from public.base_breakdown_items');
    expect(importTemplateDelete).toBeGreaterThanOrEqual(0);
    expect(importBaseDelete).toBeGreaterThan(importTemplateDelete);
    expect(migration).toMatch(
      /lock table public\.estimate_templates,[\s\S]*?public\.estimate_template_sections,[\s\S]*?public\.estimate_template_lines,[\s\S]*?public\.base_breakdown_items[\s\S]*?in share mode;/
    );
    const calls = migration.match(/perform public\.lock_legacy_estimate_source\(\);/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(migration).toContain('pg_advisory_xact_lock(2147483001)');
  });

  it('二重計上exactは数量・単位・単価・金額・備考まで比較する', () => {
    expect(migration).toContain('m.legacy_quantity::numeric = l.quantity');
    expect(migration).toContain("coalesce(lower(btrim(m.legacy_unit)), '') = coalesce(lower(btrim(l.unit)), '')");
    expect(migration).toContain('m.legacy_unit_price::numeric = l.unit_price');
    expect(migration).toContain('m.legacy_amount::numeric = l.amount');
    expect(migration).toContain('m.legacy_remark');
  });

  it('legacy adminだけではHQ移行監査権限を迂回できない', () => {
    expect(migration).toContain('can_view_legacy_base_migration');
    expect(migration).toContain('can_manage_legacy_base_migration');
    expect(migration).not.toMatch(/select\s+public\.is_admin\(\)[\s\S]*?organization_memberships/i);
    expect(migration).toContain("o.organization_type = 'headquarters'");
    expect(migration).toContain("m.status = 'active'");
    expect(migration).toContain("o.status = 'active'");
  });

  it('HQ viewerは旧staff roleに阻まれずDB権限判定へ到達できる', () => {
    expect(actions).toContain("requireUser('/admin/base-migration')");
    expect(actions).not.toContain("requireStaff('/admin/base-migration')");
    expect(page).toContain("requireUser('/admin/base-migration')");
    expect(adminLayout).toContain("pathname === '/admin/base-migration'");
    expect(adminLayout).toContain("requireUser('/admin/base-migration')");
    expect(proxy).toContain("requestHeaders.set('x-wing-pathname', pathname)");
  });

  it('監査判断は楽観ロックversionを必須にする', () => {
    expect((migration.match(/decision_version integer not null default 0/g) ?? []).length).toBe(3);
    expect(migration).toContain('p_expected_version integer');
    expect(migration).toContain('decision_version = decision_version + 1');
    expect(migration).toContain('decision_version = p_expected_version');
    expect(actions).toContain("const decisionVersionSchema = z.string().regex(/^\\d+$/).transform(Number)");
    expect(actions).toContain('expected_version: decisionVersionSchema');
    expect(page).toContain('name="expected_version"');
  });

  it('authenticatedの直接writeを禁止し、更新は監査RPCに限定する', () => {
    expect(migration).toMatch(
      /revoke all privileges on table public\.legacy_base_migration_batches,[\s\S]*?from public, anon, authenticated;/i
    );
    expect(migration).toMatch(
      /grant select on public\.legacy_base_migration_batches,[\s\S]*?to authenticated;/i
    );
    expect(actions).not.toMatch(
      /\.from\('(legacy_base_migration_batches|legacy_base_breakdown_mappings|legacy_base_spec_mappings|legacy_estimate_duplicate_checks|legacy_migration_financial_snapshots)'\)[\s\S]{0,160}\.(insert|update|delete)\(/
    );
  });

  it('参照専用UIと重複解決は誤操作を避ける', () => {
    expect(page).toContain('disabled={!editable}');
    expect(page).toContain("defaultValue={row.resolution === 'pending' ? '' : String(row.resolution)} required");
    expect(page).toContain('<option value="" disabled>解決方法を選択</option>');
    expect(page).toContain('break-all font-mono text-xs');
    expect(page).toContain('DB最終検証を実行して「移行準備完了」にする');
  });
});
