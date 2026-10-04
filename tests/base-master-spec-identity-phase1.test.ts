import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261002190000_base_master_spec_identity_phase1.sql'),
  'utf8'
);

// Comments document intentionally deferred phases and may name downstream domains.
// Wiring assertions must inspect executable SQL, not prose comments.
const executableSql = migration
  .replace(/--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('Base Master仕様identity corrective Phase 1', () => {
  it('spec_codeをnullableのまま追加し、推測backfillやNOT NULL化をしない', () => {
    expect(migration).toMatch(/add column if not exists spec_code text/i);
    expect(migration).not.toMatch(/alter column spec_code set not null/i);
    expect(executableSql).not.toMatch(/update\s+public\.base_masters\s+set\s+spec_code/i);
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

  it('公開履歴後は既存identity不変条件を維持したままspecを追加する', () => {
    expect(migration).toMatch(
      /from public\.base_master_revisions r[\s\S]*?r\.base_master_id = old\.id[\s\S]*?r\.status in \('published', 'superseded'\)/i
    );
    for (const field of [
      'base_model_id',
      'owner_organization_id',
      'spec_code',
      'fire_spec_code',
      'cloned_from_revision_id',
    ]) {
      expect(migration).toContain(`new.${field} is distinct from old.${field}`);
    }
    expect(migration).toMatch(
      /before update of base_model_id, owner_organization_id, spec_code, fire_spec_code, cloned_from_revision_id/i
    );
  });

  it('Phase 1では既存RPCやSimulator・Quote・Standard Estimateの接続を変更しない', () => {
    expect(executableSql).not.toContain('create_base_master_draft(');
    expect(executableSql).not.toContain('save_base_master_draft(');
    expect(executableSql).not.toContain('publish_base_master_draft(');
    expect(executableSql).not.toMatch(/\bpublic\.standard_estimate[a-z0-9_]*\b/i);
    expect(executableSql).not.toMatch(/\bpublic\.estimate_templates\b/i);
    expect(executableSql).not.toMatch(/\bpublic\.configurations\b/i);
    expect(executableSql).not.toMatch(/\bpublic\.(?:quotes?|quote_[a-z0-9_]*)\b/i);
    expect(executableSql).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|alter\s+table)\s+(?:public\.)?(?:quotes?|quote_[a-z0-9_]*)\b/i
    );
    expect(executableSql).not.toMatch(/\bsimulator[a-z0-9_]*\b/i);
  });

  it('SECURITY DEFINER helperはsearch_pathを固定し、app roleへ直接EXECUTEを公開しない', () => {
    expect(migration).toMatch(
      /create or replace function public\.prevent_base_master_identity_change_after_publish\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i
    );
    expect(migration).toContain('from public.base_master_revisions r');
    expect(migration).toMatch(
      /alter function public\.prevent_base_master_identity_change_after_publish\(\)[\s\S]*?owner to postgres/i
    );
    expect(migration).toMatch(
      /revoke execute on function public\.prevent_base_master_identity_change_after_publish\(\)[\s\S]*?from public, anon, authenticated, service_role/i
    );
  });
});
