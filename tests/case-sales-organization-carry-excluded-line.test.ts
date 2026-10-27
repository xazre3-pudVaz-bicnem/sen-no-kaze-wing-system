import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261016130000_case_sales_organization.sql'), 'utf8').replace(/\r\n/g, '\n');

describe('製造依頼の関数の作り直しで、#529 の「契約対象外を写さない」1 行を消さない', () => {
  it('作り直しの直後に、判定の関数がある DB でだけ同じ目印で 1 行を足し直す', () => {
    const fn = migration.indexOf('create or replace function public.send_manufacturing_order(p_order_id uuid, p_expected_lock_version integer)');
    const carry = migration.indexOf('do $carry_excluded_line$');
    expect(fn).toBeGreaterThan(0);
    expect(carry).toBeGreaterThan(fn);
    const block = migration.slice(carry, migration.indexOf('$carry_excluded_line$;', carry));
    expect(block).toContain("to_regprocedure('public.quote_line_explicit_state(text)') is null");
    expect(block).toContain("E'        from public.quote_items qi where qi.quote_id = q.id\\n'");
    expect(block).toContain("and public.quote_line_explicit_state(qi.remark) is distinct from ''excluded''");
    // 目印は作り直した本文にちょうど 1 回だけある
    const body = migration.slice(fn, migration.indexOf('\n$$;\n', fn));
    expect(body.split('        from public.quote_items qi where qi.quote_id = q.id\n').length - 1).toBe(1);
    // 関数の属性（owner・SECURITY DEFINER・search_path・EXECUTE）が変わらないことを確かめる
    expect(block).toContain('owner / security definer / search_path / EXECUTE changed');
  });
});
