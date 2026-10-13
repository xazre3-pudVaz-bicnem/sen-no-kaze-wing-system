import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseLineMoney, lineMoney, revisionMoney, sectionMoney } from '@/lib/domain/standard-estimate-money';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013170000_standard_estimate_money_contract.sql');
const runtime = read('scripts/db-rehearsal/runtime-security.sql');

function functionBody(name: string) {
  const start = migration.indexOf(`create function public.${name}(`);
  return migration.slice(start, migration.indexOf('$$;', migration.indexOf('as $$', start)));
}

describe('標準見積の金額の取り決め（PR E）：migration', () => {
  it('既存の Revision がある DB では何も変えずに停止する（金額の正本を後から変えない）', () => {
    expect(migration).toContain("raise exception 'PRECONDITION: standard_estimate_revisions already has rows");
  });

  it('率の範囲・trunc の明細金額・POR は NULL・fixed は新しく使わない', () => {
    expect(migration).toContain('sales_fee_rate between 1.0000 and 1.5000');
    expect(migration).toContain('and expense_rate between 0.0000 and 0.3000');
    expect(migration).toContain('and markup_rate between 1.0000 and 2.5000');
    expect(migration).toContain('and amount = trunc(quantity * unit_price)::integer');
    expect(migration).toContain('and cost_amount = trunc(quantity * cost_unit_price)::integer');
    expect(migration).toContain("(price_mode = 'por' and unit_price is null and amount is null and cost_unit_price is null and cost_amount is null)");
    expect(migration).toContain("raise exception 'POSTCONDITION: line amounts must use trunc, not round';");
    expect(migration).toContain("if new.expense_method = 'fixed' and (tg_op = 'INSERT' or old.expense_method is distinct from 'fixed') then");
  });

  it('本体は本体 Revision の整数の基準原価単価から計算し、明細を写さない（販売費率 → 掛率の順に trunc）', () => {
    const recalc = functionBody('recalculate_standard_estimate_revision');
    expect(recalc).toContain('trunc(l.quantity * trunc(l.unit_price * rev.sales_fee_rate))');
    expect(recalc).toContain('trunc(l.quantity * trunc(trunc(l.unit_price * rev.sales_fee_rate) * rev.markup_rate))');
    expect(recalc).toContain('from public.base_master_revision_lines l');
    expect(recalc).toContain("coalesce(sum(l.cost_amount) filter (where l.price_mode <> 'por'), 0)");
    expect(recalc).toContain('tax = trunc(v_subtotal * tax_rate)::integer');
    expect(functionBody('save_standard_estimate_draft')).toContain("raise exception 'VALIDATION: %行目の区分が不正です（本体の明細は本体マスターで管理します）'");
  });

  it('RPC は権限を状態判定より前に確認し、計算関数は API から実行できない。公開済みの率・金額は変えられない', () => {
    for (const name of ['create_standard_estimate_draft', 'save_standard_estimate_draft', 'publish_standard_estimate_revision', 'start_next_standard_estimate_revision']) {
      const body = functionBody(name);
      const forbidden = body.indexOf("raise exception 'FORBIDDEN");
      expect(forbidden, name).toBeGreaterThan(0);
      expect(forbidden, name).toBeLessThan(body.indexOf("raise exception 'LOCKED"));
    }
    expect(migration).not.toMatch(/grant execute on function public\.recalculate_standard_estimate_revision/);
    expect(migration).toContain("raise exception 'LOCKED: 公開済みの標準見積の率・金額は変更できません'");
    expect(functionBody('publish_standard_estimate_revision')).toContain(`     set status = 'superseded'
   where standard_estimate_master_id = m.id and status = 'published';`);
  });

  it('次の Revision は fixed の経費を自動で引き継がず停止する', () => {
    expect(functionBody('start_next_standard_estimate_revision')).toContain(
      "raise exception 'LOCKED: 固定額の経費を含む Revision からは自動で引き継げません。経費の計算方法（率／なし）を選んで新しく作成してください'"
    );
  });
});

describe('DB の計算と画面の試算が一致する（実行時検査と同じ入力）', () => {
  it('実行時検査 14-3 の期待値は、TS の試算と同じ値', () => {
    const rates = { salesFeeRate: '1.07', expenseRate: '0.15', markupRate: '1.5', taxRate: '0.10' };
    const base = sectionMoney([baseLineMoney(18200, 12, rates)], 'rate', rates);
    const option = sectionMoney(
      [lineMoney({ mode: 'auto', quantity: 1, costUnitPrice: 46150 }, rates), lineMoney({ mode: 'por', quantity: 1, costUnitPrice: null }, rates)],
      'rate',
      rates
    );
    const money = revisionMoney([base, option, sectionMoney([], 'rate', rates), sectionMoney([], 'none', rates)], -719, rates);
    const expected = `${money.subtotal}/${money.tax}/${money.total}/${money.costTotal}/${money.hasPor}`;
    expect(expected).toBe('482000/48200/530200/321813/true');
    expect(runtime).toContain(`'${expected}'`);
    expect(runtime).toContain(`'0/1/${base.costLineSubtotal}/${base.saleLineSubtotal}'`);
  });
});
