import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const FILE = 'supabase/migrations/20261104113000_v25_expense_manual.sql';
const migration = read(FILE);
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

/** 目印を差し込む関数の呼び出し（関数ごとの回数） */
function patchCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of sqlOnly.matchAll(/select pg_temp\.expense_patch_function\(\s*'public\.([a-z0-9_]+)\(/g)) {
    counts[match[1]] = (counts[match[1]] ?? 0) + 1;
  }
  return counts;
}

describe('A-2 ⑥ 経費の手動指定の migration（20261104113000）', () => {
  it('v2.5 の一式（〜20261102130000）の後、A-3（20261104110000）の後・代理店（20261104120000〜）の前に入る番号', () => {
    const names = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();
    const index = names.indexOf('20261104113000_v25_expense_manual.sql');
    expect(index).toBeGreaterThan(names.indexOf('20261102130000_v25_standard_quote_drafts.sql'));
    expect(index).toBeGreaterThan(names.indexOf('20261104100000_unused_draft_variant_safe_delete.sql'));
    expect(names.filter((name) => name.startsWith('20261104113000'))).toHaveLength(1);
  });

  it('前提の確認：v2.5 と標準見積から作る見積の関数があり、⑥ の列・関数がまだ無いこと', () => {
    expect(sqlOnly).toContain("to_regprocedure('public.create_quote_revision_v25(uuid, jsonb, integer, text, text)') is null");
    expect(sqlOnly).toContain("to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)') is null");
    expect(sqlOnly).toContain("to_regprocedure('public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)') is null");
    expect(sqlOnly).toContain("raise exception 'PRECONDITION: v2.5 manual expense objects already exist'");
    expect(sqlOnly.trim().startsWith('begin;')).toBe(true);
    expect(sqlOnly.trim().endsWith('commit;')).toBe(true);
  });

  it('既存の関数は丸ごと作り直さず、目印を確かめて差し込む（15 本・35 か所。所有者・権限・search_path が変われば止める）', () => {
    expect(sqlOnly).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(sqlOnly).toContain("raise exception 'PRECONDITION: the definition of % has % markers (expected 1)'");
    expect(sqlOnly).toContain("raise exception 'POSTCONDITION: owner / security definer / search_path / ACL of % changed (% -> %)'");
    expect(patchCounts()).toEqual({
      pricing_calculate: 4,
      prevent_new_fixed_standard_estimate_expense: 1,
      standard_estimate_v25_calc_input: 1,
      standard_estimate_v25_recalculate: 3,
      start_standard_estimate_v25_draft: 3,
      save_standard_estimate_v25_draft: 1,
      standard_estimate_v25_configuration_money: 1,
      write_standard_estimate_quote_items: 3,
      get_quote_v25_context: 1,
      create_quote_revision_v25: 7,
      apply_standard_quote_draft: 5,
      materialize_standard_quote_draft: 2,
      save_standard_quote_draft: 1,
      write_quote_internal_snapshot: 1,
      prepare_quote_revision_draft: 1,
    });
    expect(sqlOnly).toContain('drop function pg_temp.expense_patch_function(regprocedure, text, text);');
  });

  it('計算：手動の額は経費を掛ける区分だけ。結果に区分の経費の決め方を返す', () => {
    expect(sqlOnly).toContain("message = format('VALIDATION: 区分 %s には経費を掛けないため、経費の手動の額は指定できません', v_code);");
    expect(sqlOnly).toContain("v_fixed_expense := public.pricing_input_integer(v_section -> 'expense_amount', '経費の手動の額', 0, 2147483647);");
    expect(sqlOnly).toContain("'expense_method', case when v_fixed_expense is not null then 'fixed' when v_expense_target then 'rate' else 'none' end,");
  });

  it('標準見積：fixed は v2.5 の編集の RPC の中だけ。再計算は手動の額を変えず、原価側の経費は率のまま', () => {
    expect(sqlOnly).toContain('and not (public.standard_estimate_v25_writer_active()');
    expect(sqlOnly).toContain("v_expense := case when v_fixed then v_fixed_amount");
    expect(sqlOnly).toContain("set expense_method = case when v_fixed then 'fixed' when v_target then 'rate' else 'none' end,");
    // 原価側の経費（v_cost_expense）の式は差し込みで変えていない（率のまま）
    expect(sqlOnly).not.toContain('v_cost_expense :=');
    // 新しい下書きへは方法と額を写す。v2.5 以前の下書きを切り替えるときの固定額は引き継がない（今までどおり）
    expect(sqlOnly).toContain("if cur.pricing_model is distinct from 'v2.5'");
    expect(sqlOnly).toContain("where s.revision_id = d.id and s.expense_method = 'fixed';");
    // 保存の expenses は経費を掛ける区分だけ・0〜100,000,000 円の整数
    expect(sqlOnly).toContain("message = format('VALIDATION: %s には経費を掛けないため、経費の決め方は指定できません', v_exp_label);");
    expect(sqlOnly).toContain("message = format('VALIDATION: %sの経費の手動の額は、0〜100,000,000 円の整数で入力してください', v_exp_label);");
  });

  it('シミュレーター・Web の見積：手動の区分は手動の額のまま、経費の行に率を出さない、決め方を見積に残して変えない', () => {
    expect(sqlOnly).toContain("when s.expense_method = 'fixed' then s.expense_amount::bigint");
    expect(sqlOnly).toContain("v25_expenses = public.standard_estimate_v25_expense_settings(r.id)");
    expect(sqlOnly).toContain("select '交通費、労災、安全管理費等' || case when p_method = 'fixed' then '' else '（' || p_rate_label || '%）' end;");
    expect(sqlOnly).toContain("raise exception 'QUOTE_LINEAGE_IMMUTABLE: 見積の経費の決め方は変更できません' using errcode = 'P0001';");
    expect(sqlOnly).toContain('before update of v25_expenses on public.quotes');
    // 第 2 版以降：前の版の決め方を引き継ぎ、本体諸費用は本部・総代理店だけが変えられる
    expect(sqlOnly).toContain('v_expense_settings := coalesce(parent.v25_expenses, public.quote_v25_default_expenses(rule.expense_target_sections));');
    expect(sqlOnly).toContain("if v_section = 'base' and not v_can_edit_base and (v_expense_settings -> 'base') is distinct from v_row then");
  });

  it('Web 以外の下書き：fixed は v2.5 の版から作った下書きの経費を掛ける区分だけ。版の率は今と同じく変えられない', () => {
    expect(sqlOnly).toContain("if v_method = 'fixed' and v_v25 and v_section = any(coalesce(v_expense_targets, '{}'::text[])) then");
    expect(sqlOnly).toContain("raise exception 'VALIDATION: 経費の計算方法は「率」か「なし」を選んでください（固定額は使えません）' using errcode = 'P0001';");
    expect(sqlOnly).toContain("raise exception 'VALIDATION: v2.5 の標準見積から作った見積は、版の率（販売費率・経費率・掛率）で計算します（変えられません。値引きなどは調整額で入れてください）'");
    expect(sqlOnly).toContain('expense_amounts = excluded.expense_amounts,');
    expect(sqlOnly).toContain('n.expense_methods, n.expense_amounts, q.subtotal');
    expect(sqlOnly).toContain('values (d.id, s.sales_fee_rate, s.expense_rate, s.markup_rate, s.expense_methods, s.expense_amounts, s.cost_total);');
    expect(sqlOnly).toContain('add constraint quote_draft_internals_expense_amounts check (public.quote_expense_amounts_valid(expense_methods, expense_amounts));');
    expect(sqlOnly).toContain('add constraint quote_internal_snapshots_expense_amounts check (public.quote_expense_amounts_valid(expense_methods, expense_amounts));');
  });

  it('権限：新しい部品は所有者 postgres・API のロールから実行できない（postconditions でも確かめる）', () => {
    for (const fn of [
      'quote_expense_amounts_valid(jsonb, jsonb)',
      'standard_estimate_v25_expense_settings(uuid)',
      'quote_v25_default_expenses(text[])',
      'quote_v25_expense_description(text, text)',
      'quotes_v25_expenses_guard()',
    ]) {
      expect(sqlOnly).toContain(`alter function public.${fn} owner to postgres;`);
      expect(sqlOnly).toContain(`revoke all on function public.${fn} from public, anon, authenticated, service_role;`);
    }
    // check 制約の検査だけは、表に書ける service_role が実行できる（check 制約の関数は書き込むロールの権限で動く）
    expect((sqlOnly.match(/grant execute on function public\./g) ?? []).length).toBe(1);
    expect(sqlOnly).toContain('grant execute on function public.quote_expense_amounts_valid(jsonb, jsonb) to service_role;');
    expect((sqlOnly.match(/set search_path = ''/g) ?? []).length).toBe(5);
  });

  it('Web の第 2 版以降：明細は 300 行まで（経費の決め方は明細に数えない）', () => {
    expect(sqlOnly).toContain("where (e.value ->> 'source') is distinct from 'expense') > 300 then");
    expect(sqlOnly).toContain('if pg_catalog.jsonb_array_length(p_lines) > 303');
    expect(sqlOnly).toContain("raise exception 'POSTCONDITION: the line limit of create_quote_revision_v25 was not patched';");
  });

  it('データは変えない（列を足すだけ。既存の見積・下書き・発行の記録の新しい列は空のまま）', () => {
    expect(sqlOnly).toContain("raise exception 'POSTCONDITION: existing quotes and drafts must not change';");
    expect(sqlOnly).not.toMatch(/\b(delete\s+from|truncate)\b/i);
    expect(sqlOnly).not.toMatch(/update\s+public\.(quotes|quote_items|quote_drafts|quote_internal_snapshots)\b/i);
  });

  it('実 DB の検査に登録している', () => {
    expect(read('scripts/db-rehearsal/check.mjs')).toContain("import { runtimeV25ExpenseManual } from './runtime-v25-expense-manual.mjs';");
    expect(read('scripts/db-rehearsal/check.mjs')).toContain('runtime = mergeRuntime(runtime, await runtimeV25ExpenseManual(client));');
    expect(fs.existsSync(path.join(root, 'scripts/db-rehearsal/runtime-v25-expense-manual.sql'))).toBe(true);
  });
});
