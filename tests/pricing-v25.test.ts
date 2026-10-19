import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculatePricingV25, type PricingCalculationRule, type PricingTaxRule } from '@/lib/domain/pricing-v25';

type Vector = {
  name: string;
  rule: string;
  input: unknown;
  expected?: Record<string, unknown>;
  error?: string;
};

const root = process.cwd();
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/pricing-v25-vectors.json'), 'utf8')) as {
  rules: Record<string, Omit<PricingCalculationRule, 'id'>>;
  tax: Omit<PricingTaxRule, 'id'>;
  vectors: Vector[];
};
const migration = fs
  .readFileSync(path.join(root, 'supabase/migrations/20261016210000_pricing_rule_versions.sql'), 'utf8')
  .replace(/\r\n/g, '\n');
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

const rule = (name: string): PricingCalculationRule => ({ id: `rule-${name}`, ...fixture.rules[name] });
const tax: PricingTaxRule = { id: 'tax-1', ...fixture.tax };
const standard = rule('standard');

describe('v2.5 正式計算（TypeScript）：手で検算したテストベクトル', () => {
  for (const vector of fixture.vectors) {
    it(vector.name, () => {
      const run = () => calculatePricingV25(rule(vector.rule), tax, vector.input);
      if (vector.error) {
        expect(run).toThrow(new RegExp(`^${vector.error}:`));
        return;
      }
      expect(run()).toEqual({
        formula_code: 'v2.5',
        calc_rule_version_id: `rule-${vector.rule}`,
        tax_rule_version_id: 'tax-1',
        ...vector.expected,
      });
    });
  }
});

describe('v2.5 正式計算（TypeScript）：浮動小数点を使わない', () => {
  it('2 進の誤差が出る値でも、10 進のまま切り捨てる', () => {
    // 100 × 1.13 は浮動小数点では 112.99999999999999（Math.trunc で 112）。10 進では 113
    expect(Math.trunc(100 * 1.13)).toBe(112);
    const result = calculatePricingV25(standard, tax, {
      rates: { sales_fee_rate: 1.13, markup_rate: '1', expense_rate: '0' },
      sections: [{ code: 'option', lines: [{ key: 'o1', mode: 'auto', quantity: '1', standard_cost: 100 }] }],
    });
    expect(result.sections[0].lines[0]).toMatchObject({ cost_unit_price: 113, sale_unit_price: 113, amount: 113 });
  });

  it('大きな金額でも 1 円単位まで正確に計算する', () => {
    const result = calculatePricingV25(standard, tax, {
      rates: { sales_fee_rate: '1.4999', markup_rate: '2.4999', expense_rate: '0.2999' },
      sections: [{ code: 'base', lines: [{ key: 'b1', mode: 'auto', quantity: '1', standard_cost: 2147483647 }] }],
    });
    // 見積用原価単価 = trunc(2,147,483,647 × 1.4999) = 3,221,010,722（2,147,483,647 × 14,999 = 32,210,107,221,353 → /10,000）
    expect(result.sections[0].lines[0].cost_unit_price).toBe(3221010722);
    // 売価単価 = trunc(3,221,010,722 × 2.4999) = 8,052,204,703（× 24,999 = 80,522,047,039,278 → /10,000）
    expect(result.sections[0].lines[0].sale_unit_price).toBe(8052204703);
    // 区分経費 = trunc(8,052,204,703 × 0.2999) = 2,414,856,190、税 = trunc(10,467,060,893 × 0.1) = 1,046,706,089
    expect(result.sections[0].expense).toBe(2414856190);
    expect(result).toMatchObject({ adjusted_subtotal: 10467060893, tax: 1046706089, total: 11513766982 });
  });

  it('扱える金額（±999,999,999,999 円）を超えたら計算しない', () => {
    expect(() =>
      calculatePricingV25(standard, tax, {
        rates: { sales_fee_rate: '99.9999', markup_rate: '99.9999', expense_rate: '0' },
        sections: [{ code: 'base', lines: [{ key: 'b1', mode: 'auto', quantity: '9999999999.9999', standard_cost: 2147483647 }] }],
      })
    ).toThrow(/^VALIDATION:/);
  });

  it('指数表記になる数値（1e-7 など）は小数 4 桁を超えるので不可', () => {
    expect(() =>
      calculatePricingV25(standard, tax, {
        rates: { sales_fee_rate: 1, markup_rate: 1, expense_rate: 0 },
        sections: [{ code: 'base', lines: [{ key: 'b1', mode: 'manual', quantity: 1e-7, manual_unit_price: 1 }] }],
      })
    ).toThrow(/^VALIDATION:/);
  });

  it('対応していない式・税の方式は計算しない（勝手に別の式で計算しない）', () => {
    expect(() => calculatePricingV25({ ...standard, formula_code: 'legacy' }, tax, { rates: {}, sections: [] })).toThrow(/^VALIDATION:/);
    expect(() => calculatePricingV25(standard, { ...tax, tax_mode: 'reduced_rate' }, { rates: {}, sections: [] })).toThrow(/^VALIDATION:/);
  });
});

describe('v2.5 PR-A2：計算ルール・税ルールの Version（migration）', () => {
  it('1 つの transaction で適用し、表と関数を足すだけで既存の計算・表は変えない', () => {
    expect(sqlOnly.trimStart().startsWith('begin;')).toBe(true);
    expect(sqlOnly.trimEnd().endsWith('commit;')).toBe(true);
    expect(sqlOnly).not.toMatch(/alter\s+table\s+public\.(?!pricing_calculation_rule_versions|tax_rule_versions)\w+/i);
    expect(sqlOnly).not.toMatch(/create\s+or\s+replace\s+function/i);
  });

  it('計算ルール・税ルールは変えられない Version で、現在有効は 1 つだけ', () => {
    expect(sqlOnly).toMatch(/create unique index pricing_calculation_rule_versions_current_key\s+on public\.pricing_calculation_rule_versions \(\(true\)\)\s+where superseded_at is null;/);
    expect(sqlOnly).toMatch(/create unique index tax_rule_versions_current_key\s+on public\.tax_rule_versions \(\(true\)\)\s+where superseded_at is null;/);
    expect(sqlOnly).toContain('before update or delete on public.pricing_calculation_rule_versions');
    expect(sqlOnly).toContain('before update or delete on public.tax_rule_versions');
    expect(sqlOnly).toContain("formula_code text not null check (formula_code in ('v2.5'))");
    expect(sqlOnly).toContain("rounding_mode text not null default 'trunc' check (rounding_mode = 'trunc')");
    expect(sqlOnly).toContain("tax_mode text not null check (tax_mode in ('full_single_rate'))");
  });

  it('初期の Version は v2.5 の初期仕様（経費・自動計算は本体・内外装・オプション、別途工事は対象外・全額課税の単一税率 10%）', () => {
    expect(sqlOnly).toContain("'CALC-V25-1', 1, 'v2.5', 'trunc',");
    // 別途工事は経費・自動計算の対象にしない（2026-10-19 先方の確定方針）
    expect(sqlOnly).toMatch(/'CALC-V25-1', 1, 'v2\.5', 'trunc',\s+array\['base', 'interior_exterior', 'option'\]::text\[\],\s+array\['base', 'interior_exterior', 'option'\]::text\[\],/);
    expect(sqlOnly).toContain("'TAX-10-1', 1, 'full_single_rate', 0.100000, 'trunc',");
    expect(fixture.rules.standard.expense_target_sections).toEqual(['base', 'interior_exterior', 'option']);
    expect(fixture.rules.standard.auto_price_sections).toEqual(['base', 'interior_exterior', 'option']);
    expect(fixture.tax.tax_rate).toBe('0.100000');
  });

  it('DB の計算は宣言した境界だけで trunc し、1,000 円未満の切り捨てや round を持たない', () => {
    const body = sqlOnly.slice(sqlOnly.indexOf('create function public.pricing_calculate('));
    expect(body).toContain('pg_catalog.trunc(v_selection * v_sales_fee)');
    expect(body).toContain('pg_catalog.trunc(v_cost_unit * v_markup)');
    expect(body).toContain('pg_catalog.trunc(v_sale_unit * v_qty)');
    expect(body).toContain('pg_catalog.trunc(v_priced * v_expense_rate)');
    expect(body).toContain('pg_catalog.trunc(v_adjusted * v_tax.tax_rate)');
    expect(body).toContain('if not (v_code = any(v_rule.auto_price_sections)) then');
    expect(body).not.toMatch(/\bround\s*\(|\bfloor\s*\(|\bceil(ing)?\s*\(|1000\b/i);
    expect(body).not.toMatch(/::(double precision|float|real)\b/i);
  });

  it('正式計算の関数と内部の部品は API のどの role からも実行できない', () => {
    for (const fn of ['pricing_calculate(uuid, uuid, jsonb)', 'pricing_input_decimal(jsonb, text, integer)',
      'pricing_input_integer(jsonb, text, numeric, numeric, numeric)', 'pricing_checked_amount(numeric, text)',
      'pricing_rule_version_immutable()']) {
      expect(sqlOnly).toContain(`revoke all on function public.${fn} from public, anon, authenticated, service_role;`);
      expect(sqlOnly).not.toContain(`grant execute on function public.${fn}`);
      expect(sqlOnly).toContain(`alter function public.${fn} owner to postgres;`);
    }
    expect(sqlOnly).toContain('grant execute on function public.can_view_pricing_rule_versions() to authenticated;');
    expect((sqlOnly.match(/set search_path = ''/g) ?? []).length).toBe(6);
  });

  it('Version の表は本部（admin と本部の editor 以上）だけが読め、書き込みは誰にも開けない', () => {
    for (const table of ['pricing_calculation_rule_versions', 'tax_rule_versions']) {
      expect(sqlOnly).toContain(`alter table public.${table} enable row level security;`);
      expect(sqlOnly).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role;`);
      expect(sqlOnly).toContain(`grant select on table public.${table} to authenticated;`);
      expect(sqlOnly).not.toMatch(new RegExp(`grant\\s+(insert|update|delete|truncate|all)[^;]*on\\s+table\\s+public\\.${table}`, 'i'));
    }
    expect(sqlOnly).toContain("and public.current_organization_member_rank(o.id) >= 1");
  });
});
