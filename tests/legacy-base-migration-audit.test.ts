import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260914170000_legacy_base_migration_audit.sql'),
  'utf8'
);
const actions = readFileSync(join(process.cwd(), 'lib/actions/base-migration.ts'), 'utf8');

describe('旧本体内訳の移行監査基盤', () => {
  it('監査PRでは旧正本や新本体へ移行書込みをしない', () => {
    expect(migration).not.toMatch(/insert\s+into\s+public\.base_masters/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.base_master_revisions/i);
    expect(migration).not.toMatch(/update\s+public\.base_breakdown_items/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.base_breakdown_items/i);
    expect(migration).not.toMatch(/update\s+public\.estimate_templates/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.estimate_templates/i);
  });

  it('元データ全体をSHA-256で固定する', () => {
    expect(migration).toContain('legacy_base_migration_source_hash');
    expect(migration).toContain("'sha256'");
    expect(migration).toContain("'base_breakdown_items'");
    expect(migration).toContain("'estimate_templates'");
    expect(migration).toContain("'estimate_template_sections'");
    expect(migration).toContain("'estimate_template_lines'");
  });

  it('危険な広域キーワード判定を避け、屋根タルキは本体に固定する', () => {
    expect(migration).toContain("v_name like '%屋根タルキ%'");
    expect(migration).not.toContain("v_name like '%屋根%'");
    expect(migration).not.toContain("v_section like '%金物%'");
    expect(migration).toContain("'review'::text");
    expect(migration).toContain('自動判定対象外。名称だけで本体/内外装を決めない');
  });

  it('断熱材と天井ラワンベニアを本体ホワイトリストに含める', () => {
    expect(migration).toContain("v_name like '%天井ラワンベニア%'");
    expect(migration).toContain("v_name like '%スタイロフォーム%'");
    expect(migration).toContain("v_name like '%グラスウール%'");
    expect(migration).toContain("v_name like '%断熱材%'");
  });

  it('レビュー確定は未確認・旧仕様対応・重複候補・元データ変更をすべて止める', () => {
    expect(migration).toContain('移行元データがレビュー開始後に変更されています');
    expect(migration).toContain('未確認の旧本体明細があります');
    expect(migration).toContain('旧仕様から新本体への対応が未確認です');
    expect(migration).toContain('未解決の二重計上候補があります');
    expect(migration).toContain('金額スナップショットが移行元仕様数と一致しません');
    expect(migration).toContain('旧標準見積の内部金額に不整合があります');
  });

  it('authenticatedの直接writeを禁止し、HQ用RPCだけで更新する', () => {
    expect(migration).toMatch(
      /revoke all privileges on table public\.legacy_base_migration_batches,[\s\S]*?from public, anon, authenticated;/i
    );
    expect(migration).toMatch(
      /grant select on public\.legacy_base_migration_batches,[\s\S]*?to authenticated;/i
    );
    expect(migration).toContain('can_manage_legacy_base_migration');
    expect(migration).toContain("o.organization_type = 'headquarters'");
  });

  it('Server Actionは監査RPCだけを利用する', () => {
    for (const rpc of [
      'create_legacy_base_migration_batch',
      'set_legacy_base_mapping_decision',
      'set_legacy_base_spec_mapping',
      'resolve_legacy_estimate_duplicate',
      'finalize_legacy_base_migration_review',
      'cancel_legacy_base_migration_batch',
    ]) {
      expect(actions).toContain(`.rpc('${rpc}'`);
    }

    expect(actions).not.toMatch(
      /\.from\('(legacy_base_migration_batches|legacy_base_breakdown_mappings|legacy_base_spec_mappings|legacy_estimate_duplicate_checks|legacy_migration_financial_snapshots)'\)[\s\S]{0,160}\.(insert|update|delete)\(/
    );
  });

  it('移行判断に使うUUIDをServer Actionでも検証する', () => {
    expect(actions).toContain('batch_id: z.uuid()');
    expect(actions).toContain('mapping_id: z.uuid()');
    expect(actions).toContain('base_model_id: z.uuid()');
    expect(actions).toContain('check_id: z.uuid()');
  });

  it('画面入口はlegacy profile roleではなくDBの組織権限判定を主とする', () => {
    expect(actions).toContain("requireStaff('/admin/base-migration')");
    expect(actions).not.toContain("requireCatalogEditor('/admin/base-migration')");
    expect(migration).toContain('can_manage_legacy_base_migration');
  });
});
