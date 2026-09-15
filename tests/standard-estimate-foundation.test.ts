import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20260915012500_standard_estimate_foundation.sql');
const exteriorFacesMigration = read('supabase/migrations/20260830091000_exterior_four_faces.sql');

function tableBlock(table: string): string {
  const pattern = 'create table if not exists public\\\\.' + table + ' \\\\(([\\\\s\\\\S]*?)\\\\n\\\\);';
  const match = migration.match(new RegExp(pattern, 'i'));
  expect(match, table + ' definition').not.toBeNull();
  return match?.[1] ?? '';
}

describe('Standard Estimate Master / Revision DB基盤契約', () => {
  it('確定した6テーブルだけを追加しgroup/diff tableを作らない', () => {
    const tables = [
      'standard_estimate_masters',
      'standard_estimate_revisions',
      'standard_estimate_revision_sections',
      'standard_estimate_revision_lines',
      'standard_estimate_revision_baseline_items',
      'standard_estimate_revision_baseline_variants',
    ];
    for (const table of tables) {
      expect(migration).toContain('create table if not exists public.' + table);
    }
    const created = migration.match(/create table if not exists public\.standard_estimate_[a-z_]+/gi) ?? [];
    expect(created).toHaveLength(6);
    expect(migration).not.toContain('group_key');
    expect(migration).not.toMatch(/create table if not exists public\.standard_estimate_[a-z_]*groups?/i);
    expect(migration).not.toMatch(/create table if not exists public\.standard_estimate_[a-z_]*diff/i);
  });

  it('Master identityはowner + base_master + specで一意、base_model整合とHQ所有を保証する', () => {
    const block = tableBlock('standard_estimate_masters');
    expect(block).toContain('unique (owner_organization_id, base_master_id, spec_code)');
    expect(block).not.toContain('unique (owner_organization_id, base_model_id, spec_code)');
    expect(block).toContain('base_model_id uuid not null');
    expect(block).toContain('base_master_id uuid not null');
    expect(migration).toContain("if v_owner_type <> 'headquarters' then");
    expect(migration).toContain('v_base_model_id is distinct from new.base_model_id');
    expect(migration).toContain('prevent_standard_estimate_master_identity_change_after_publish');
    for (const column of ['owner_organization_id', 'base_model_id', 'base_master_id', 'spec_code']) {
      expect(migration).toContain('new.' + column + ' is distinct from old.' + column);
    }
  });

  it('Revisionはversion/lock/tax/adjustment/金額整合と1 Draft・1 Publishedを制約する', () => {
    const block = tableBlock('standard_estimate_revisions');
    expect(block).toContain('version integer not null check (version >= 1)');
    expect(block).toContain('lock_version integer not null default 0 check (lock_version >= 0)');
    expect(block).toContain('tax_rate numeric(8, 6)');
    expect(block).toContain("check (source_kind in ('ui', 'legacy_excel'))");
    expect(block).toContain('check (subtotal = subtotal_raw + standard_adjustment_amount)');
    expect(block).toContain('check (total = subtotal + tax)');
    expect(block).toContain('standard_adjustment_amount = 0');
    expect(block).toContain('standard_adjustment_reason');
    expect(migration).toContain('standard_estimate_revisions_one_draft_idx');
    expect(migration).toContain("where status = 'draft'");
    expect(migration).toContain('standard_estimate_revisions_one_published_idx');
    expect(migration).toContain("where status = 'published'");
  });

  it('Base Revisionは同じBase Masterのpublished/supersededをpinできcurrent限定にしない', () => {
    expect(migration).toContain("v_revision_status not in ('published', 'superseded')");
    expect(migration).toContain('v_revision_base_master_id is distinct from v_master_base_master_id');
    expect(migration).toContain('v_base_master_model_id is distinct from v_master_base_model_id');
    expect(migration).not.toMatch(/base_master\.current_published_revision_id\s*=\s*new\.base_master_revision_id/i);
  });

  it('sectionは非base 3分類のみでlabel/sort_orderを持たず諸費用計算を制約する', () => {
    const block = tableBlock('standard_estimate_revision_sections');
    expect(block).toContain("section_code in ('interior_exterior', 'option', 'sitework')");
    expect(block).not.toMatch(/\blabel\b/i);
    expect(block).not.toMatch(/\bsort_order\b/i);
    expect(block).toContain("expense_method in ('rate', 'fixed', 'none')");
    expect(block).toContain('expense_amount = floor(line_subtotal::numeric * expense_rate)::integer');
    expect(block).toContain("expense_method = 'none' and expense_rate is null and expense_amount = 0");
    expect(block).toContain('check (total = line_subtotal + expense_amount)');
  });

  it('lineはstable line_key・numeric(14,4)・整数円・amount計算を保証する', () => {
    const block = tableBlock('standard_estimate_revision_lines');
    expect(block).toContain('line_key uuid not null default gen_random_uuid()');
    expect(block).toContain('unique (revision_id, line_key)');
    expect(block).toContain('quantity numeric(14, 4)');
    expect(block).toContain('unit_price integer');
    expect(block).toContain('amount integer');
    expect(block).toContain('check (amount = round(quantity * unit_price)::integer)');
    expect(block).toContain('group_label text');
    expect(block).not.toContain('group_key');
    expect(block).toContain('foreign key (revision_id, section_code)');
  });

  it('baseline itemは表示snapshotと基準価格snapshotを持つ', () => {
    const block = tableBlock('standard_estimate_revision_baseline_items');
    for (const column of [
      'option_code_snapshot',
      'option_name_snapshot',
      'category_code_snapshot',
      'category_name_snapshot',
      'unit_price_snapshot',
      'price_on_request_snapshot',
    ]) {
      expect(block).toContain(column);
    }
    expect(block).toContain('baseline_key uuid not null default gen_random_uuid()');
    expect(block).toContain('unique (revision_id, baseline_key)');
    expect(migration).toContain('validate_standard_estimate_baseline_item_refs');
  });

  it('baseline uniqueはmulti categoryを壊さず外壁4面だけ各target 1商品にする', () => {
    const block = tableBlock('standard_estimate_revision_baseline_items');
    expect(block).toContain('unique (revision_id, selection_target_code, option_id)');
    expect(block).not.toMatch(/unique \(revision_id,\s*option_category_id,\s*selection_target_code\)/i);
    expect(migration).toContain('standard_estimate_baseline_items_one_exterior_face_idx');
    for (const target of ['exterior_front', 'exterior_right', 'exterior_back', 'exterior_left']) {
      expect(migration).toContain("'" + target + "'");
    }
    for (const face of ['front', 'right', 'back', 'left']) {
      expect(exteriorFacesMigration).toContain("'" + face + "'");
    }
    expect(block).not.toMatch(/unique \(revision_id,\s*option_id\)/i);
  });

  it('baseline variantは参照関係と表示・追加価格snapshotを保持する', () => {
    const block = tableBlock('standard_estimate_revision_baseline_variants');
    for (const column of [
      'variant_group_code_snapshot',
      'variant_group_name_snapshot',
      'variant_choice_code_snapshot',
      'variant_choice_name_snapshot',
      'extra_price_snapshot',
      'price_on_request_snapshot',
    ]) {
      expect(block).toContain(column);
    }
    expect(block).toContain('unique (baseline_item_id, variant_group_id)');
    expect(block).toContain('unique (baseline_item_id, variant_choice_id)');
    expect(migration).toContain('v_group_option_id is distinct from v_option_id');
    expect(migration).toContain('v_choice_group_id is distinct from new.variant_group_id');
  });

  it('Published/supersededはRevisionと全子要素をtriggerでimmutableにする', () => {
    expect(migration).toContain('prevent_published_standard_estimate_revision_mutation');
    expect(migration).toContain('prevent_non_draft_standard_estimate_child_write');
    expect(migration).toContain('prevent_non_draft_standard_estimate_variant_write');
    for (const trigger of [
      'standard_estimate_revision_sections_draft_only',
      'standard_estimate_revision_lines_draft_only',
      'standard_estimate_revision_baseline_items_draft_only',
      'standard_estimate_revision_baseline_variants_draft_only',
    ]) {
      expect(migration).toContain(trigger);
    }
    expect(migration).toContain("old.status = 'published'");
    expect(migration).toContain("new.status = 'superseded'");
    expect(migration).toContain('LOCKED: 公開済みStandard Estimate Revisionの内容は変更できません');
  });

  it('current Published pointerは同じMasterのpublishedだけを指しcommit時にも検査する', () => {
    expect(migration).toContain('standard_estimate_masters_current_published_revision_fk');
    expect(migration).toContain('r.standard_estimate_master_id = new.id');
    expect(migration).toContain("r.status = 'published'");
    expect(migration).toContain('create constraint trigger standard_estimate_current_pointer_consistency');
    expect(migration).toContain('deferrable initially deferred');
    expect(migration).toContain('validate_standard_estimate_current_pointer_at_commit');
  });

  it('RLSはHQ editor以上のDraft権限とstaffのPublished履歴閲覧を分離する', () => {
    expect(migration).toContain('can_create_standard_estimate_master_for_org');
    expect(migration).toContain('can_edit_standard_estimate_master');
    expect(migration).toContain('can_view_standard_estimate_master');
    expect(migration).toContain('can_view_standard_estimate_revision');
    expect(migration).toContain('public.current_organization_member_rank(owner_org.id) >= 1');
    expect(migration).toContain("r.status in ('published', 'superseded')");

    for (const table of [
      'standard_estimate_masters',
      'standard_estimate_revisions',
      'standard_estimate_revision_sections',
      'standard_estimate_revision_lines',
      'standard_estimate_revision_baseline_items',
      'standard_estimate_revision_baseline_variants',
    ]) {
      expect(migration).toContain('alter table public.' + table + ' enable row level security;');
    }
  });

  it('authenticatedは6テーブルをSELECTだけ利用し直接writeできない', () => {
    expect(migration).toMatch(
      /revoke all privileges on table public\.standard_estimate_masters,[\s\S]*?public\.standard_estimate_revision_baseline_variants[\s\S]*?from public, anon, authenticated;/i
    );
    expect(migration).toMatch(
      /grant select on public\.standard_estimate_masters,[\s\S]*?public\.standard_estimate_revision_baseline_variants[\s\S]*?to authenticated;/i
    );
    expect(migration).not.toMatch(/create policy [^\n]+[\s\S]{0,180}?for (insert|update|delete|all)/i);
  });

  it('今回のfoundationにDraft/Save/Publish RPCを実装しない', () => {
    expect(migration).not.toMatch(
      /create or replace function public\.(create|start|save|publish|discard)_standard_estimate/i
    );
  });

  it('旧正本・Quote・ConfigurationへDDL/DML変更を加えない', () => {
    for (const table of [
      'estimate_templates',
      'estimate_template_sections',
      'estimate_template_lines',
      'base_breakdown_items',
      'quotes',
      'quote_items',
      'configurations',
      'configuration_items',
    ]) {
      const pattern = '(?:alter\\\\s+table|update|delete\\\\s+from|insert\\\\s+into|truncate\\\\s+table)\\\\s+public\\\\.' + table + '\\\\b';
      expect(migration).not.toMatch(new RegExp(pattern, 'i'));
    }
    expect(migration).not.toContain('recalculate_configuration');
  });
});
