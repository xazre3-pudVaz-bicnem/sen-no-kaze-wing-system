import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261002190000_base_master_spec_identity_phase1.sql'),
  'utf8'
);

describe('Base Master仕様identity corrective Phase 1', () => {
  it('spec_codeをnullableのまま追加し、推測backfillやNOT NULL化をしない', () => {
    expect(migration).toMatch(/add column if not exists spec_code text/i);
    expect(migration).not.toMatch(/alter column spec_code set not null/i);
    expect(migration).not.toMatch(/update\s+public\.base_masters\s+set\s+spec_code/i);
    expect(migration).toContain('do not infer/backfill without audit');
  });

  it('spec_codeはlowercase・trim済み・空白なしだけを許す', () => {
    expect(migration).toContain('base_masters_spec_code_format');
    expect(migration).toContain('spec_code = lower(spec_code)');
    expect(migration).toContain('spec_code = btrim(spec_code)');
    expect(migration).toContain("spec_code !~ '[[:space:]]'");
  });

  it('監査済みnon-null行ではowner×model×spec×fireの重複をDBで拒否する', () => {
    expect(migration).toMatch(
      /create unique index if not exists base_masters_owner_model_spec_fire_nonnull_uidx[\s\S]*?owner_organization_id,[\s\S]*?base_model_id,[\s\S]*?spec_code,[\s\S]*?fire_spec_code[\s\S]*?where spec_code is not null/i
    );
  });

  it('PublishedまたはSuperseded後はspecを含むidentityを変更できない', () => {
    expect(migration).toContain("r.status in ('published', 'superseded')");
    expect(migration).toContain('new.spec_code is distinct from old.spec_code');
    expect(migration).toMatch(
      /before update of base_model_id, owner_organization_id, spec_code, fire_spec_code, cloned_from_revision_id/i
    );
  });

  it('Phase 1では既存RPCやSimulator・Quote・Standard Estimateの接続を変更しない', () => {
    expect(migration).not.toContain('create_base_master_draft(');
    expect(migration).not.toContain('save_base_master_draft(');
    expect(migration).not.toContain('publish_base_master_draft(');
    expect(migration).not.toContain('standard_estimate_masters');
    expect(migration).not.toContain('estimate_templates');
    expect(migration).not.toContain('configurations');
    expect(migration).not.toContain('quotes');
  });

  it('SECURITY DEFINER helperはsearch_pathを固定し、app roleへ直接EXECUTEを公開しない', () => {
    expect(migration).toMatch(
      /create or replace function public\.prevent_base_master_identity_change_after_publish\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i
    );
    expect(migration).toMatch(
      /revoke execute on function public\.prevent_base_master_identity_change_after_publish\(\)[\s\S]*?from public, anon, authenticated, service_role/i
    );
  });
});
