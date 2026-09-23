import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260923080000_quote_revision_prod_compat.sql'),
  'utf8'
);

function functionBody(source: string, functionName: string): string {
  const start = source.indexOf(`create or replace function public.${functionName}`);
  expect(start, `${functionName} definition`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const terminator = tail.match(/\n(?:end;?\s*)?\$\$;/);
  expect(terminator?.index, `${functionName} terminator`).toBeTypeOf('number');
  const end = start + (terminator?.index ?? -1) + (terminator?.[0].length ?? 0);
  expect(end, `${functionName} terminator position`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Quote revision production compatibility corrective', () => {
  it('本番既存kindを保持して内外装2区分だけ拡張する', () => {
    for (const kind of [
      'base',
      'base_expense',
      'interior_exterior',
      'interior_exterior_expense',
      'option',
      'option_expense',
      'installation',
      'free',
      'discount',
    ]) {
      expect(migration).toContain(`'${kind}'`);
    }

    expect(migration).toContain('drop constraint if exists quote_items_kind_check');
    expect(migration).toContain('add constraint quote_items_kind_check');
  });

  it('未適用の標準見積helperへ依存しないstandalone migrationである', () => {
    for (const missingProductionHelper of [
      'replace_estimate_templates',
      'replace_estimate_templates_with_baselines',
      'configuration_master_section_total',
      'estimate_baseline_master_section_total',
    ]) {
      expect(migration).not.toContain(missingProductionHelper);
    }
  });

  it('migration runnerのtransaction管理を妨げる明示BEGIN/COMMITを持たない', () => {
    expect(migration).not.toMatch(/^begin;\s*$/im);
    expect(migration).not.toMatch(/^commit;\s*$/im);
  });

  it('create_quote_revisionは8区分を受け入れて現行集計へ揃える', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain("'interior_exterior', 'interior_exterior_expense'");
    expect(body).toContain("elsif v_kind = 'interior_exterior' then");
    expect(body).toContain("elsif v_kind = 'interior_exterior_expense' then");
    expect(body).toContain('v_base, v_base_exp, v_int + v_opt, v_int_exp + v_opt_exp, v_inst');
    expect(body).toContain(
      'v_sub_raw := v_base + v_base_exp + v_int + v_int_exp + v_opt + v_opt_exp + v_inst;'
    );
  });

  it('金額はRPCで入力を正規化して再計算し千円未満切捨てと税floorを維持する', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain("v_qty := coalesce((r ->> 'quantity')::numeric, 1);");
    expect(body).toContain('if v_qty < 0.01 or v_qty > 99999 then');
    expect(body).toContain("v_unit_price_raw := coalesce((r ->> 'unit_price')::numeric, 0);");
    expect(body).toContain('v_unit_price_raw <> trunc(v_unit_price_raw)');
    expect(body).toContain('v_unit_price := v_unit_price_raw::integer;');
    expect(body).toContain('v_amount := round(v_unit_price * v_qty)::integer;');
    expect(body).toContain('round(v_unit_price * v_qty)::integer');
    expect(body).toContain('v_sub := floor(v_sub_raw / 1000.0)::integer * 1000;');
    expect(body).toContain('v_tax := floor(v_sub * parent.tax_rate)::integer;');
    expect(body).toContain('v_sub - v_sub_raw');
  });

  it('親Quoteをlockしてissuedだけを改訂可能にする', () => {
    const body = functionBody(migration, 'create_quote_revision');
    const lock = body.indexOf('for update;');
    const lifecycle = body.indexOf("if parent.status <> 'issued' then");
    const insert = body.indexOf('insert into public.quotes(');

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lifecycle).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(lifecycle);
  });

  it('担当代理店は本体2区分だけ禁止し本部・総代理店は全区分を扱える', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain('v_can_edit_base := v_rank >= 2;');
    expect(body).toContain(
      "if not (v_can_any or (v_rank >= 1 and parent.dealer_id = v_uid)) then"
    );
    expect(body).toContain(
      "if not v_can_edit_base and v_kind in ('base', 'base_expense') then"
    );
    expect(body).not.toContain("v_kind not in ('installation', 'free')");
  });

  it('SECURITY DEFINERを空search_pathで固定しauthenticatedだけにEXECUTEを戻す', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain('security definer');
    expect(body).toContain("set search_path = ''");
    expect(body).toContain('auth.uid()');
    expect(body).toContain('public.current_role_rank()');
    expect(migration).toContain(
      'revoke execute on function public.create_quote_revision(uuid, jsonb, text)\n  from public, anon, authenticated, service_role;'
    );
    expect(migration).toContain(
      'grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;'
    );
    expect(migration).not.toContain(
      'grant execute on function public.create_quote_revision(uuid, jsonb, text) to service_role;'
    );
  });

  it('既存Quoteをmigration適用だけでは書き換えない', () => {
    const definitionStart = migration.indexOf(
      'create or replace function public.create_quote_revision'
    );
    const beforeDefinition = migration.slice(0, definitionStart);

    expect(beforeDefinition).not.toMatch(/update\s+public\.quotes/i);
    expect(beforeDefinition).not.toMatch(/insert\s+into\s+public\.quotes/i);
    expect(beforeDefinition).not.toMatch(/delete\s+from\s+public\.quotes/i);
  });
});
