import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const migration = read('supabase/migrations/20260915012000_legacy_base_draft_validation_publish.sql');
const actions = read('lib/actions/base-migration.ts');
const page = read('app/admin/base-migration/page.tsx');
const detail = read('app/admin/base-masters/[id]/page.tsx');

describe('旧本体移行Draftの検算・防火区分確認・Publish', () => {
  it('監査履歴列と防火確認列を追加し、initial値は上書きしない', () => {
    expect(migration).toContain('validated_by uuid');
    expect(migration).toContain('validated_at timestamptz');
    expect(migration).toContain('completed_by uuid');
    expect(migration).toContain('confirmed_fire_spec_code text');
    expect(migration).toContain('fire_spec_review_note text');
    expect(migration).toContain('fire_spec_reviewed_by uuid');
    expect(migration).toContain('fire_spec_reviewed_at timestamptz');
    expect(migration).toContain('fire_spec_review_version integer not null default 0');
    expect(migration).not.toMatch(/set\s+initial_fire_spec_code\s*=/i);
  });

  it('防火確認はHQ管理権限・migrated・Draft・未Publish・楽観ロックをDBで保証する', () => {
    expect(migration).toContain('confirm_legacy_base_migration_fire_spec');
    expect(migration).toContain('public.can_manage_legacy_base_migration()');
    expect(migration).toContain("v_batch.status <> 'migrated'");
    expect(migration).toContain("v_revision.status <> 'draft'");
    expect(migration).toContain('v_master.current_published_revision_id is not null');
    expect(migration).toContain("p_fire_spec_code is null or p_fire_spec_code not in ('non_fire', 'fire')");
    expect(migration).toContain("nullif(btrim(coalesce(p_review_note, '')), '') is null");
    expect(migration).toContain('v_output.fire_spec_review_version <> p_expected_review_version');
    expect(migration).toContain('CONFLICT: 防火区分は他のユーザーによって更新されています。画面を再読込してください');
    expect(migration).toContain('set confirmed_fire_spec_code = p_fire_spec_code');
    expect(migration).toContain('fire_spec_reviewed_by = v_uid');
    expect(migration).toContain('fire_spec_reviewed_at = now()');
    expect(migration).toContain('fire_spec_review_required = false');
    expect(migration).toContain('fire_spec_review_version = fire_spec_review_version + 1');
  });

  it('migration Draftを通常save/discard/publishからDB側で拒否し、通常Draft経路を維持する', () => {
    expect(migration).toContain('is_legacy_base_migration_draft');
    expect(migration).toContain('save_base_master_draft_regular_internal');
    expect(migration).toContain('discard_base_master_draft_regular_internal');
    expect(migration).toContain('旧本体移行Draftは移行監査画面から確認してください');
    expect(migration).toContain('旧本体移行Draftは移行batch専用Publishから公開してください');
    expect(migration).toContain("return public.publish_base_master_draft_internal(p_revision_id, v_uid, 'regular')");
    expect(migration).toContain('return public.save_base_master_draft_regular_internal(');
    expect(migration).toContain('return public.discard_base_master_draft_regular_internal(p_revision_id)');
  });

  it('Publish triggerは防火確認済みかつvalidatedのmigration Revisionだけを許可する', () => {
    expect(migration).toContain('prevent_unreviewed_legacy_base_migration_publish');
    expect(migration).toContain("old.status = 'draft' and new.status = 'published'");
    expect(migration).toContain('v_guard.fire_spec_review_required');
    expect(migration).toContain('v_guard.confirmed_fire_spec_code is null');
    expect(migration).toContain('v_guard.fire_spec_review_note');
    expect(migration).toContain('v_guard.fire_spec_reviewed_by is null');
    expect(migration).toContain('v_guard.fire_spec_reviewed_at is null');
    expect(migration).toContain("v_guard.batch_status <> 'validated'");
  });

  it('provenanceを旧→新と新→旧の双方向で検算し、代表specの行数も確認する', () => {
    expect(migration).toContain('新lineへ追跡できない旧本体行があります');
    expect(migration).toContain('旧本体行へ追跡できない余計な新lineがあります');
    expect(migration).toContain('新line数が代表旧specのapproved + base行数と一致しません');
    expect(migration).toContain('o.representative_legacy_spec_code');
    expect(migration).toContain("m.review_status = 'approved'");
    expect(migration).toContain("m.target_classification = 'base'");
    expect(migration).toContain('l.legacy_item_id is distinct from m.legacy_item_id');
  });

  it('明細7項目を完全一致させ、amount・subtotal・諸費用・totalを1円単位で検算する', () => {
    for (const field of [
      'm.legacy_section is distinct from nl.section',
      'm.legacy_name is distinct from nl.name',
      'm.legacy_quantity is distinct from nl.quantity',
      'm.legacy_unit is distinct from nl.unit',
      'm.legacy_unit_price is distinct from nl.unit_price',
      'm.legacy_amount is distinct from nl.amount',
      'm.legacy_remark is distinct from nl.remark',
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain('round(nl.unit_price::numeric * nl.quantity)::integer');
    expect(migration).toContain('o.source_classified_base_line_total');
    expect(migration).toContain('r.line_subtotal <> o.target_line_subtotal');
    expect(migration).toContain('r.expense_method is distinct from o.target_expense_method');
    expect(migration).toContain('r.expense_rate is distinct from o.target_expense_rate');
    expect(migration).toContain('r.expense_amount is distinct from o.target_expense_amount');
    expect(migration).toContain('floor(r.line_subtotal::numeric * r.expense_rate)::integer');
    expect(migration).toContain('r.total is distinct from r.line_subtotal + r.expense_amount');
    expect(migration).toContain('r.total is distinct from o.target_total');
  });

  it('HQ ownership・Draft status・current pointer・防火確認をvalidated条件として再確認する', () => {
    expect(migration).toContain("owner_org.code <> 'gijutsu-no-mori'");
    expect(migration).toContain("owner_org.organization_type <> 'headquarters'");
    expect(migration).toContain("owner_org.status <> 'active'");
    expect(migration).toContain("r.status <> 'draft'");
    expect(migration).toContain('b.current_published_revision_id is not null');
    expect(migration).toContain('o.confirmed_fire_spec_code in (\'non_fire\', \'fire\')');
    expect(migration).toContain('b.fire_spec_code = o.confirmed_fire_spec_code');
  });

  it('最終検算はmigrated→validatedだけを進め、検算者を記録する', () => {
    expect(migration).toContain('finalize_legacy_base_migration_draft_validation');
    expect(migration).toContain("if v_batch.status = 'validated' then");
    expect(migration).toContain("if v_batch.status <> 'migrated' then");
    expect(migration).toContain("set status = 'validated'");
    expect(migration).toContain('validated_by = v_uid');
    expect(migration).toContain('validated_at = now()');
  });

  it('一括Publishはvalidated全件を決定的順序で同一RPC transaction内から内部helperへ渡す', () => {
    expect(migration).toContain('publish_legacy_base_migration_batch');
    expect(migration).toContain("if v_batch.status <> 'validated' then");
    expect(migration).toContain('order by o.base_model_id::text, o.proposed_group_key, o.id::text');
    expect(migration).toContain("public.publish_base_master_draft_internal(");
    expect(migration).toContain("'migration'");
    expect(migration).toContain('1回のRPC = 1 transaction');
    expect(migration).toContain("set status = 'completed'");
    expect(migration).toContain('completed_by = v_uid');
    expect(migration).toContain('completed_at = now()');
    const publishLoop = migration.indexOf('for v_output in');
    const completedUpdate = migration.indexOf("set status = 'completed'");
    expect(publishLoop).toBeGreaterThan(-1);
    expect(completedUpdate).toBeGreaterThan(publishLoop);
    expect(migration.slice(publishLoop, completedUpdate)).not.toMatch(/exception\s+when/i);
  });

  it('migration Publishは監査済み金額との差異を修正せず停止し、Publish後の値も再検査する', () => {
    expect(migration).toContain('移行Draftの金額が監査済み値と一致しません');
    expect(migration).toContain('validate_legacy_base_migration_published_outputs');
    expect(migration).toContain("r.status <> 'published'");
    expect(migration).toContain('b.current_published_revision_id is distinct from o.revision_id');
    expect(migration).toContain('r.line_subtotal is distinct from o.target_line_subtotal');
    expect(migration).toContain('r.expense_amount is distinct from o.target_expense_amount');
    expect(migration).toContain('r.total is distinct from o.target_total');
    expect(migration).toContain('b.fire_spec_code is distinct from o.confirmed_fire_spec_code');
  });

  it('内部helperはauthenticatedへ公開せず、利用者向けRPCだけをgrantする', () => {
    expect(migration).toMatch(
      /revoke all on function public\.publish_base_master_draft_internal\(uuid, uuid, text\)[\s\S]*?from public, anon, authenticated, service_role;/i
    );
    expect(migration).toMatch(
      /grant execute on function public\.save_base_master_draft[\s\S]*?public\.confirm_legacy_base_migration_fire_spec[\s\S]*?public\.publish_legacy_base_migration_batch[\s\S]*?to authenticated, service_role;/i
    );
  });

  it('Server ActionsはZod検証後に専用RPCを呼ぶ', () => {
    expect(actions).toContain("fire_spec_code: z.enum(['non_fire', 'fire'])");
    expect(actions).toContain('review_note: z.string().trim().min(1).max(1000)');
    expect(actions).toContain("supabase.rpc('confirm_legacy_base_migration_fire_spec'");
    expect(actions).toContain("supabase.rpc('finalize_legacy_base_migration_draft_validation'");
    expect(actions).toContain("supabase.rpc('publish_legacy_base_migration_batch'");
  });

  it('移行監査UIは防火確認・最終検算・Publish・completed表示を持つ', () => {
    expect(page).toContain('防火区分を確認');
    expect(page).toContain('確認根拠');
    expect(page).toContain('移行Draftを最終検算');
    expect(page).toContain('✓ 最終検算済み');
    expect(page).toContain('検算済み新本体をPublish');
    expect(page).toContain('✓ 新本体Publish完了');
    expect(page).toContain('Simulator・Quote・標準見積は旧方式のままです。');
  });

  it('本体詳細ではmigration Draft editorを隠し、同じ明細をread-onlyで表示する', () => {
    expect(detail).toContain("from('legacy_base_migration_draft_outputs')");
    expect(detail).toContain('migrationDraftLocked');
    expect(detail).toContain('旧本体移行Draft');
    expect(detail).toContain('明細・金額・諸費用を直接変更できません');
    expect(detail).toContain('readOnlyRevisionIds');
    expect(detail).toContain('旧本体移行監査を開く');
    expect(detail).toContain('!migrationDraftLocked && detailView.editableRevisionId === draft.id');
  });

  it('旧正本・Standard Estimate・Quote・Simulatorへwriteしない', () => {
    expect(migration).not.toMatch(/update\s+public\.base_breakdown_items/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.base_breakdown_items/i);
    expect(migration).not.toMatch(/update\s+public\.estimate_templates/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.estimate_templates/i);
    expect(migration).not.toMatch(/(insert into|update|delete from)\s+public\.standard_estimate/i);
    expect(migration).not.toMatch(/(insert into|update|delete from)\s+public\.[a-z0-9_]*quote/i);
    expect(migration).not.toMatch(/(insert into|update|delete from)\s+public\.[a-z0-9_]*simulator/i);
  });
});
