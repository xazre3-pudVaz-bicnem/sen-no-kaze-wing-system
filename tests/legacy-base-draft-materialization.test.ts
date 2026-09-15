import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260915003301_legacy_base_draft_materialization.sql'),
  'utf8'
);
const actions = readFileSync(join(process.cwd(), 'lib/actions/base-migration.ts'), 'utf8');
const page = readFileSync(join(process.cwd(), 'app/admin/base-migration/page.tsx'), 'utf8');

describe('監査済み旧本体から新本体Draft作成', () => {
  it('readyだけを起点にし、再実行はmigratedを検証して冪等に返す', () => {
    expect(migration).toContain("v_batch.status not in ('ready', 'migrated')");
    expect(migration).toContain("if v_batch.status = 'migrated' then");
    expect(migration).toContain("'idempotent_replay', true");
    expect(migration.indexOf("if v_batch.status = 'migrated' then"))
      .toBeLessThan(migration.indexOf('perform public.assert_legacy_base_migration_source_current(p_batch_id);'));
    expect(migration).toContain('unique (migration_batch_id, base_model_id, proposed_group_key)');
  });

  it('旧正本は変更せず、Simulator・Quote・Publishにも接続しない', () => {
    expect(migration).not.toMatch(/update\s+public\.base_breakdown_items/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.base_breakdown_items/i);
    expect(migration).not.toMatch(/update\s+public\.estimate_templates/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.estimate_templates/i);
    expect(migration).not.toMatch(/set\s+status\s*=\s*'published'/i);
    expect(migration).not.toMatch(/set\s+current_published_revision_id\s*=/i);
    expect(page).toContain('Publish・Simulator・Quoteの参照先は変更しません。');
  });

  it('approved + base行だけを新Revision lineへコピーする', () => {
    expect(migration).toContain("m.review_status = 'approved'");
    expect(migration).toContain("m.target_classification = 'base'");
    expect(migration).not.toMatch(/target_classification\s*=\s*'(interior_exterior|option|sitework)'/i);
    expect(migration).toContain('本体以外または別groupの旧行が新本体Draftへ紐付いています');
  });

  it('proposed_group_key単位で本体を作り、同一group互換性を再検査する', () => {
    expect(migration).toContain('group by s.base_model_id, s.proposed_group_key');
    expect(migration).toContain('legacy_base_spec_body_signature');
    expect(migration).toContain('legacy_base_expense_rate is distinct from');
    expect(migration).toContain('legacy_base_expense is distinct from');
    expect(migration).toContain('legacy_base_total is distinct from');
  });

  it('HQ所有のDraftだけを作成する', () => {
    expect(migration).toContain("o.code = 'gijutsu-no-mori'");
    expect(migration).toContain("o.organization_type = 'headquarters'");
    expect(migration).toContain("'draft'");
    expect(migration).toContain('owner_organization_id');
  });

  it('旧行から新lineへの追跡を保存し、複数旧specは同じ新lineへ対応できる', () => {
    expect(migration).toContain('create table if not exists public.legacy_base_migration_line_links');
    expect(migration).toContain('mapping_id uuid not null');
    expect(migration).toContain('revision_line_id uuid');
    expect(migration).toContain('revision_line_key uuid not null');
    expect(migration).toContain('row_number() over');
    expect(migration).toContain('同一groupの旧行を新lineへ完全追跡できません');
  });

  it('旧base判定行と新Draftを1円単位で検算する', () => {
    expect(migration).toContain('source_classified_base_line_total');
    expect(migration).toContain('source_classified_base_line_total = target_line_subtotal');
    expect(migration).toContain('m.legacy_amount <> nl.amount');
    expect(migration).toContain('r.line_subtotal <> o.target_line_subtotal');
    expect(migration).toContain('旧base判定行合計と新Draft line_subtotalが1円単位で一致しません');
  });

  it('旧諸費用条件を保持し、新Draftの通常計算規則と整合させる', () => {
    expect(migration).toContain("v_expense_method := 'rate'");
    expect(migration).toContain('floor(v_source_total::numeric * v_expense_rate)::integer');
    expect(migration).toContain("v_expense_method := 'fixed'");
    expect(migration).toContain('legacy_base_expense_rate');
    expect(migration).toContain('target_expense_amount');
    expect(migration).toContain('旧本体諸費用率を新Revisionの6桁精度へ無損失で保存できません');
  });

  it('元データlockとSTALE再検査をDraft作成直前にも行う', () => {
    expect(migration).toContain('perform public.lock_legacy_estimate_source();');
    expect(migration).toContain('perform public.assert_legacy_base_migration_source_current(p_batch_id);');
    expect(migration).toContain('for update;');
  });

  it('防火区分はPublish前の明示確認対象として記録し、未確認DraftのPublishをDBで拒否する', () => {
    expect(migration).toContain("initial_fire_spec_code text not null default 'non_fire'");
    expect(migration).toContain('fire_spec_review_required boolean not null default true');
    expect(migration).toContain('prevent_unreviewed_legacy_base_migration_publish');
    expect(migration).toContain("new.status = 'published'");
    expect(migration).toContain('旧本体移行Draftは防火区分の確認が完了するまでPublishできません');
    expect(page).toContain('防火区分はDraft段階ではnon_fireを仮置きし、Publish前に明示確認します。');
  });

  it('authenticatedの直接writeを禁止し、専用RPCだけを公開する', () => {
    expect(migration).toMatch(
      /revoke all privileges on table public\.legacy_base_migration_draft_outputs,[\s\S]*?from public, anon, authenticated;/i
    );
    expect(migration).toContain('alter table public.legacy_base_migration_draft_outputs enable row level security');
    expect(migration).toContain('alter table public.legacy_base_migration_line_links enable row level security');
    expect(migration).toMatch(
      /grant execute on function public\.materialize_legacy_base_migration_drafts\(uuid\)[\s\S]*?to authenticated, service_role;/i
    );
  });

  it('Server Actionと管理画面は専用RPCを使用する', () => {
    expect(actions).toContain("supabase.rpc('materialize_legacy_base_migration_drafts'");
    expect(actions).toContain("redirect(migrationUrl(parsed.data, 'drafted'))");
    expect(page).toContain('materializeLegacyBaseDraftsAction');
    expect(page).toContain('監査済みデータから新本体Draftを作成');
    expect(page).toContain("from('legacy_base_migration_draft_outputs')");
    expect(page).toContain('新本体Draft検算');
    expect(page).toContain('Draftを開く');
  });
});
