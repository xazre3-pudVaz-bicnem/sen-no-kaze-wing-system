import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260924102000_quote_revision_adjustment_carry_forward.sql'),
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

describe('Quote revision adjustment carry-forward corrective', () => {
  it('親Revisionのadjustmentを自動丸めで置き換えずそのまま使う', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain('v_sub := v_sub_raw + parent.adjustment;');
    expect(body).toContain('parent.adjustment, v_sub, parent.tax_rate, v_tax, v_sub + v_tax');
    expect(body).not.toContain('v_sub := floor(v_sub_raw / 1000.0)::integer * 1000;');
    expect(body).not.toContain('v_sub - v_sub_raw, v_sub');
  });

  it('未変更の親明細だけ保存済みamountを再利用し、親外IDや重複IDを拒否する', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain("coalesce(r ->> 'source_item_id', '') <> ''");
    expect(body).toContain('qi.quote_id = parent.id');
    expect(body).toContain('v_source_id = any(v_seen_source_ids)');
    expect(body).toContain('同じ親見積明細を複数行へ再利用することはできません');
    expect(body).toContain('親見積に存在しない明細が指定されています');
    expect(body).toContain('v_source_kind = v_kind');
    expect(body).toContain("v_source_name = coalesce(nullif(r ->> 'name', ''), '（名称未設定）')");
    expect(body).toContain("v_source_unit = coalesce(nullif(r ->> 'unit', ''), '式')");
    expect(body).toContain('v_source_unit_price = v_unit_price');
    expect(body).toContain('v_source_quantity = v_qty');
    expect(body).toContain('v_amount := v_source_amount;');
    expect(body).toContain('v_amount := round(v_unit_price * v_qty)::integer;');
    expect(body).toContain('v_qty,\n      v_amount,');
  });

  it('引継いだ調整額で税抜請負額が負になるRevisionを拒否する', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain('if v_sub < 0 then');
    expect(body).toContain('調整額を引き継ぐと税抜請負額が0円未満になります');
  });

  it('税は新しい税抜請負額からfloorで再計算する', () => {
    const body = functionBody(migration, 'create_quote_revision');
    expect(body).toContain('v_tax := floor(v_sub * parent.tax_rate)::integer;');
  });

  it('既存のlock・権限・入力検証・SECURITY DEFINER境界を維持する', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain('for update;');
    expect(body).toContain("if parent.status <> 'issued' then");
    expect(body).toContain('v_can_edit_base := v_rank >= 2;');
    expect(body).toContain("set search_path = ''");
    expect(body).toContain('auth.uid()');
    expect(body).toContain('public.current_role_rank()');
    expect(body).toContain('v_qty < 0.01 or v_qty > 99999');
    expect(body).toContain('v_unit_price_raw <> trunc(v_unit_price_raw)');
    expect(migration).toContain(
      'revoke execute on function public.create_quote_revision(uuid, jsonb, text)\n  from public, anon, authenticated, service_role;'
    );
    expect(migration).toContain(
      'grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;'
    );
  });

  it('migration適用だけでは既存Quoteを更新しない', () => {
    const definitionStart = migration.indexOf('create or replace function public.create_quote_revision');
    const beforeDefinition = migration.slice(0, definitionStart);

    expect(beforeDefinition).not.toMatch(/update\s+public\.quotes/i);
    expect(beforeDefinition).not.toMatch(/insert\s+into\s+public\.quotes/i);
    expect(beforeDefinition).not.toMatch(/delete\s+from\s+public\.quotes/i);
    expect(migration).not.toMatch(/^begin;\s*$/im);
    expect(migration).not.toMatch(/^commit;\s*$/im);
  });
});
