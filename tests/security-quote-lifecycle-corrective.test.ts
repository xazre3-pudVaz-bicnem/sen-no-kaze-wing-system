import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const corrective = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260915073200_security_quote_lifecycle_corrective.sql'),
  'utf8'
);
const estimateMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260911020000_estimate_templates.sql'),
  'utf8'
);
const simulatorMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260911050000_standard_estimate_simulator.sql'),
  'utf8'
);
const quoteResponseMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/0012_notifications_audit.sql'),
  'utf8'
);
const adminQuote = fs.readFileSync(
  path.join(root, 'app/admin/quotes/[id]/page.tsx'),
  'utf8'
);
const localStore = fs.readFileSync(path.join(root, 'lib/data/local-store.ts'), 'utf8');
const compatibilityTest = fs.readFileSync(
  path.join(root, 'tests/configuration-migration-compat.test.ts'),
  'utf8'
);

function functionBody(source: string, functionName: string): string {
  const start = source.indexOf(`create or replace function public.${functionName}`);
  expect(start, `${functionName} definition`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n$$;', start);
  expect(end, `${functionName} terminator`).toBeGreaterThan(start);
  return source.slice(start, end + 4);
}

const sourceBodies = new Map<string, string>([
  ['replace_estimate_templates', functionBody(estimateMigration, 'replace_estimate_templates')],
  [
    'configuration_master_section_total',
    functionBody(simulatorMigration, 'configuration_master_section_total'),
  ],
  [
    'estimate_baseline_master_section_total',
    functionBody(simulatorMigration, 'estimate_baseline_master_section_total'),
  ],
  ['recalculate_configuration', functionBody(simulatorMigration, 'recalculate_configuration')],
  [
    'create_quote_from_configuration',
    functionBody(simulatorMigration, 'create_quote_from_configuration'),
  ],
  ['respond_to_quote', functionBody(quoteResponseMigration, 'respond_to_quote')],
]);

describe('Security / Quote lifecycle corrective', () => {
  it('最新main migrationより後ろのforward-only migrationである', () => {
    expect(
      fs.existsSync(path.join(root, 'supabase/migrations/20260915030000_option_media.sql'))
    ).toBe(true);
    expect(Number('20260915073200')).toBeGreaterThan(Number('20260915030000'));
  });

  it('PR #118の互換設計をcorrectiveへ持ち込まない', () => {
    expect(corrective).not.toContain('insulation-floor');
    expect(corrective).not.toContain('insulation-wall');
    expect(corrective).not.toContain('insulation-ceiling');
    expect(corrective).not.toContain('exterior_faces');
    expect(corrective).not.toContain('legacyExterior');
    expect(compatibilityTest).toContain('保存済みexterior_faces=[]は明示変更まで[]を維持する');
    expect(compatibilityTest).toContain('外壁migrationは既存Configurationを4面へ自動変換しない');
  });

  it('wrapper自身がcan_edit_catalogを確認してから内部helperを呼ぶ', () => {
    const body = functionBody(corrective, 'replace_estimate_templates_with_baselines');
    const permission = body.indexOf('if not public.can_edit_catalog() then');
    const helperCall = body.indexOf('perform public.replace_estimate_templates(p_templates);');

    expect(permission).toBeGreaterThanOrEqual(0);
    expect(helperCall).toBeGreaterThan(permission);
    expect(body).toContain("set search_path = ''");
  });

  it('対象SECURITY DEFINERのsearch_pathを空に固定する', () => {
    for (const signature of [
      'public.replace_estimate_templates(jsonb)',
      'public.configuration_master_section_total(uuid, text)',
      'public.estimate_baseline_master_section_total(uuid, text)',
      'public.recalculate_configuration(uuid)',
      'public.create_quote_from_configuration(uuid, jsonb, text)',
      'public.respond_to_quote(uuid, text)',
    ]) {
      expect(corrective).toContain(`alter function ${signature} set search_path = '';`);
    }
    expect(functionBody(corrective, 'replace_estimate_templates_with_baselines')).toContain(
      "set search_path = ''"
    );
    expect(functionBody(corrective, 'create_quote_revision')).toContain("set search_path = ''");
  });

  it('search_path空化対象はアプリ依存をschema-qualified参照している', () => {
    const forbiddenUnqualified = [
      /\bfrom\s+configurations\b/i,
      /\bupdate\s+configurations\b/i,
      /\bfrom\s+quotes\b/i,
      /\bupdate\s+quotes\b/i,
      /\bfrom\s+options\b/i,
      /\bjoin\s+options\b/i,
      /\bfrom\s+estimate_templates\b/i,
      /\bupdate\s+estimate_templates\b/i,
      /\bfrom\s+configuration_items\b/i,
      /\bjoin\s+configuration_items\b/i,
      /\bfrom\s+quote_items\b/i,
      /\bupdate\s+quote_requests\b/i,
      /(?<!public\.)\bcan_edit_catalog\s*\(/i,
      /(?<!auth\.)\buid\s*\(/i,
    ];

    for (const [name, body] of sourceBodies) {
      for (const pattern of forbiddenUnqualified) {
        expect(body, `${name}: ${pattern}`).not.toMatch(pattern);
      }
    }

    const wrapper = functionBody(corrective, 'replace_estimate_templates_with_baselines');
    const revision = functionBody(corrective, 'create_quote_revision');
    for (const pattern of forbiddenUnqualified) {
      expect(wrapper, `wrapper: ${pattern}`).not.toMatch(pattern);
      expect(revision, `revision: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('内部helperはPUBLIC/anon/authenticated/service_roleからEXECUTE不可である', () => {
    for (const signature of [
      'public.replace_estimate_templates(jsonb)',
      'public.configuration_master_section_total(uuid, text)',
      'public.estimate_baseline_master_section_total(uuid, text)',
    ]) {
      expect(corrective).toContain(
        `revoke execute on function ${signature}\n  from public, anon, authenticated, service_role;`
      );
      expect(corrective).not.toContain(`grant execute on function ${signature} to authenticated;`);
      expect(corrective).not.toContain(`grant execute on function ${signature} to service_role;`);
    }
  });

  it('外部RPCは一度全roleからREVOKEしauthenticatedだけ再grantする', () => {
    for (const signature of [
      'public.replace_estimate_templates_with_baselines(jsonb)',
      'public.recalculate_configuration(uuid)',
      'public.create_quote_from_configuration(uuid, jsonb, text)',
      'public.create_quote_revision(uuid, jsonb, text)',
      'public.respond_to_quote(uuid, text)',
    ]) {
      expect(corrective).toContain(
        `revoke execute on function ${signature}\n  from public, anon, authenticated, service_role;`
      );
      expect(corrective).toContain(`grant execute on function ${signature} to authenticated;`);
      expect(corrective).not.toContain(`grant execute on function ${signature} to service_role;`);
    }
  });

  it('create_quote_revisionはFOR UPDATE後にissuedだけをallowlistする', () => {
    const body = functionBody(corrective, 'create_quote_revision');
    const lock = body.indexOf('for update;');
    const lifecycle = body.indexOf("if parent.status <> 'issued' then");
    const insert = body.indexOf('insert into public.quotes(');

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lifecycle).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(lifecycle);
    expect(body).toContain('改訂できるのは発行中（issued）の見積だけです');
  });

  it('accepted等の既存Quoteをmigration適用だけでは変更しない', () => {
    const revisionStart = corrective.indexOf('create or replace function public.create_quote_revision');
    const beforeDefinition = corrective.slice(0, revisionStart);
    expect(beforeDefinition).not.toMatch(/update\s+public\.quotes/i);
    expect(corrective).not.toMatch(
      /update\s+public\.quotes[\s\S]{0,180}where[\s\S]{0,120}status\s*=\s*'(accepted|declined|expired|cancelled)'/i
    );
  });

  it('respond_to_quoteも同じQuote行をFOR UPDATEしissued以外を拒否する', () => {
    const body = functionBody(quoteResponseMigration, 'respond_to_quote');
    expect(body).toMatch(
      /select \* into q from public\.quotes where id = p_quote_id for update;/
    );
    expect(body).toContain("if q.status <> 'issued' then");
    expect(body).toContain('if q.user_id <> auth.uid() then');
  });

  it('Accept先行/Revision先行の双方で後続を拒否できるDB契約を持つ', () => {
    const acceptBody = functionBody(quoteResponseMigration, 'respond_to_quote');
    const revisionBody = functionBody(corrective, 'create_quote_revision');

    expect(acceptBody).toContain('for update;');
    expect(acceptBody).toContain("q.status <> 'issued'");
    expect(revisionBody).toContain('for update;');
    expect(revisionBody).toContain("parent.status <> 'issued'");
    expect(revisionBody).toContain("set status = 'superseded'");
  });

  it('Quote改訂UIはissuedだけ表示可能にする', () => {
    expect(adminQuote).toContain(
      "const canRevise = quote.status === 'issued' && (canManageAllQuotes || quote.dealer_id === actor.id);"
    );
  });

  it('LocalStoreもissuedだけRevision可能にする', () => {
    expect(localStore).toContain("if (parent.status !== 'issued') {");
    expect(localStore).toContain('改訂できるのは発行中（issued）の見積だけです。');
    expect(localStore).not.toContain("if (parent.status === 'superseded') {");
  });
});
