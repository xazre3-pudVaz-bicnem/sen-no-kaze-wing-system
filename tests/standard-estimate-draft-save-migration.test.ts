import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'supabase/migrations/20260928114500_standard_estimate_draft_save.sql'
  ),
  'utf8'
);

describe('Standard Estimate Draft save migration', () => {
  it('Draft書込みはSECURITY DEFINER RPCだけに限定する', () => {
    expect(migration).toContain('create or replace function public.create_standard_estimate_draft');
    expect(migration).toContain('create or replace function public.save_standard_estimate_draft');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('auth.uid()');
    expect(migration).toContain('can_create_standard_estimate_master_for_org');
    expect(migration).toContain('can_edit_standard_estimate_master');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to authenticated, service_role');
    expect(migration).toContain(
      'from public, anon, authenticated, service_role'
    );
  });

  it('PL/pgSQL関数を正しいドル引用で終端する', () => {
    expect(migration).not.toMatch(/\n\$;\n/);
    expect(migration).toMatch(/end;\n\$\$;\n\n-- ---------- 既存Draft保存 ----------/);
  });

  it('spec_codeは公開モデルのbaseまたはpresetだけを許可する', () => {
    expect(migration).toContain('from public.base_models m');
    expect(migration).toContain("m.status = 'published'");
    expect(migration).toContain("p_spec_code = 'base'");
    expect(migration).toContain("jsonb_array_elements(coalesce(m.presets, '[]'::jsonb)) preset");
    expect(migration).toContain("preset ->> 'code' = p_spec_code");
    expect(migration).toContain('このモデルでは指定された仕様を選べません');
    expect(migration).not.toContain('from public.estimate_templates t');
  });

  it('基準本体RevisionをpinしDraftだけを保存する', () => {
    expect(migration).toContain('p_base_master_revision_id uuid');
    expect(migration).toContain("status in ('published', 'superseded')");
    expect(migration).toContain("v_revision.status <> 'draft'");
    expect(migration).toContain('base_master_revision_id');
    expect(migration).not.toContain('publish_standard_estimate');
  });

  it('楽観ロックで競合更新を拒否する', () => {
    expect(migration).toContain('p_expected_lock_version integer');
    expect(migration).toContain('for update');
    expect(migration).toContain('v_revision.lock_version <> p_expected_lock_version');
    expect(migration).toContain('lock_version = lock_version + 1');
    expect(migration).toContain('and lock_version = p_expected_lock_version');
    expect(migration).toContain('CONFLICT: 他のユーザーが更新しています');
  });

  it('新規Draftではsectionを先に作成してline FKを満たす', () => {
    const sectionBootstrap = migration.indexOf(
      "insert into public.standard_estimate_revision_sections"
    );
    const lineDelete = migration.indexOf(
      "delete from public.standard_estimate_revision_lines"
    );
    const lineInsert = migration.indexOf(
      "insert into public.standard_estimate_revision_lines"
    );
    expect(sectionBootstrap).toBeGreaterThan(-1);
    expect(lineDelete).toBeGreaterThan(sectionBootstrap);
    expect(lineInsert).toBeGreaterThan(lineDelete);
    expect(migration).toContain(
      "on conflict (revision_id, section_code) do nothing"
    );
  });

  it('金額をDB側で明細とpin済み本体から再計算する', () => {
    expect(migration).toContain('v_amount := round(v_quantity * v_unit_price)::integer');
    expect(migration).toContain('v_base_revision.total');
    expect(migration).toContain('v_subtotal_raw :=');
    expect(migration).toContain('v_subtotal := v_subtotal_raw + p_standard_adjustment_amount');
    expect(migration).toContain('v_tax := floor(v_subtotal::numeric * p_tax_rate)::integer');
    expect(migration).toContain('total = v_subtotal + v_tax');
    expect(migration).toContain('調整額がある場合は理由を入力してください');
  });

  it('Draft明細の商品参照とお客様選択区分を整合させる', () => {
    expect(migration).toContain("source_kind in ('product', 'free')");
    expect(migration).toContain('option_id uuid');
    expect(migration).toContain("'standard_changeable'");
    expect(migration).toContain("'standard_fixed'");
    expect(migration).toContain("'optional'");
    expect(migration).toContain("'hidden'");
    expect(migration).toContain("source_kind = 'product'");
    expect(migration).toContain('option_id is not null');
    expect(migration).toContain("source_kind = 'free'");
    expect(migration).toContain('option_id is null');
  });

  it('14件一覧の論理identityを異なるBase Master間でも一意にする', () => {
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(migration).toContain('pg_catalog.hashtext');
    expect(migration).toContain('join public.base_masters existing_base');
    expect(migration).toContain(
      'existing_master.owner_organization_id = v_base_master.owner_organization_id'
    );
    expect(migration).toContain('existing_master.base_model_id = p_base_model_id');
    expect(migration).toContain('existing_master.spec_code = p_spec_code');
    expect(migration).toContain(
      'existing_base.fire_spec_code = v_base_master.fire_spec_code'
    );
    expect(migration).toContain(
      'この商品モデル・用途・防火仕様の標準見積は既に作成されています'
    );
  });

  it('新規Masterのunique競合だけを作成競合として扱う', () => {
    expect(migration).toContain('begin\n    insert into public.standard_estimate_masters');
    expect(migration).toContain('when unique_violation then');
    expect(migration).toContain('insert into public.standard_estimate_revisions');
  });
});
