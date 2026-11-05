import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261104130000_case_sales_organization.sql'), 'utf8').replace(/\r\n/g, '\n');

describe('製造依頼の関数の作り直しで、#529 の「契約対象外を写さない」1 行を消さない', () => {
  it('作り直す本文に、#529 と同じ 1 行を目印の直後に入れる（この migration は #529 の後に入る）', () => {
    const fn = migration.indexOf('create or replace function public.send_manufacturing_order(p_order_id uuid, p_expected_lock_version integer)');
    expect(fn).toBeGreaterThan(0);
    const body = migration.slice(fn, migration.indexOf('\n$$;\n', fn));
    expect(body).toContain(
      "        from public.quote_items qi where qi.quote_id = q.id\n" +
        '         /* 今回の契約対象外の行は、契約した品目ではないので製造仕様に写さない（D1 までの暫定）。 */\n' +
        "         and public.quote_line_explicit_state(qi.remark) is distinct from 'excluded'\n"
    );
    // 足し直しの DO ブロックは使わない（本文に入っていると「既に入っている」で止まるため）
    expect(migration).not.toContain('do $carry_excluded_line$');
  });

  it('#529 の判定の関数が無い DB には適用しない（前提の確認）', () => {
    const preflight = migration.slice(migration.indexOf('do $preflight$'), migration.indexOf('$preflight$;'));
    expect(preflight).toContain("to_regprocedure('public.quote_line_explicit_state(text)') is null");
    expect(preflight).toContain('quote formal line guard (20261016111000) must be applied first');
  });
});
