import { describe, expect, it } from 'vitest';
import { planLegacyLineReplacement } from '@/components/admin/standard-estimate-v25-line-replacement';
import { buildV25SavePayload, type V25EditorState } from '@/lib/domain/standard-estimate-v25-view';
import { calculateV25Workbench, type V25WorkbenchCandidate, type V25WorkbenchCosts } from '@/lib/domain/standard-estimate-v25-workbench';
import type { PricingCalculationRule, PricingTaxRule } from '@/lib/domain/pricing-v25';

const base: V25EditorState = {
  sales_fee_rate: '1.07', expense_rate: '0.15', markup_rate: '1.5',
  adjustment: '0', adjustment_reason: '', slots: [],
  lines: [
    {
      key: 'legacy-1', line_key: 'old-1', section_code: 'interior_exterior',
      group_label: '屋根', name: '屋根材・旧明細', quantity: '23.5', unit: 'm',
      price_mode: 'manual', unit_price: '1500', remark: '旧仕様の備考', review_required: true,
    },
    {
      key: 'legacy-2', line_key: 'old-2', section_code: 'interior_exterior',
      group_label: 'その他', name: '工事費', quantity: '1', unit: '式',
      price_mode: 'manual', unit_price: '10000', remark: '', review_required: false,
    },
  ],
};
const product: V25WorkbenchCandidate = {
  id: 'p-wall', name: '商品台帳の外壁材', section: 'interior_exterior',
  categoryId: 'c-wall', categoryName: '外壁', categoryCode: 'exterior-wall',
  singleSelect: true, manufacturer: 'メーカー', modelNo: 'W-001',
  variantGroups: [{ id: 'color', name: '色', choices: [{ id: 'white', name: '白' }] }],
  defaultChoices: { color: 'white' },
};
const costs: V25WorkbenchCosts = {
  pinned: {}, currentProduct: { 'p-wall': 1000 }, currentChoice: { white: 0 },
};
const proposal = (state = base, candidate = product, overrideCosts = costs) =>
  planLegacyLineReplacement(state, 'legacy-1', candidate, [product, candidate], overrideCosts, 'replacement-1');

describe('旧明細1行の安全な商品置換案（UI stateのみ、DB操作なし）', () => {
  it('要見直しの旧1行を消して商品1枠に置き換え、他の行と元の状態を維持する', () => {
    const before = structuredClone(base);
    const plan = proposal();
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(base).toEqual(before); // 商品を選んだだけでは元状態を変更しない
    expect(plan.state.slots).toHaveLength(1);
    expect(plan.state.lines.map((line) => line.key)).toEqual(['legacy-2']);
    expect(plan.state.slots[0]).toMatchObject({
      key: 'replacement-1', baseline_key: null, option_id: 'p-wall',
      variant_choices: { color: 'white' }, price_mode: 'auto', quantity: '4',
      manual_unit_price: '', slot_code: '', slot_label: '', selectable_option_ids: [],
    });
    const payload = buildV25SavePayload(plan.state);
    expect(payload.lines.map((line) => line.line_key)).toEqual(['old-2']);
    expect(payload.slots).toHaveLength(1);
    expect(payload.slots[0]).toMatchObject({
      baseline_key: null, option_id: 'p-wall', variant_choice_ids: ['white'], quantity: '4', price_mode: 'auto',
    });
    expect(payload.slots[0].manual_unit_price).toBeNull();
  });

  it('旧数量23.5mを自動コピーせず、候補の数量4面で試算する。旧金額の二重計上はしない', () => {
    const plan = proposal();
    if (!plan.ok) throw Error(plan.error);
    const rule: PricingCalculationRule = {
      id: 'rule', formula_code: 'v2.5', rounding_mode: 'trunc',
      expense_target_sections: ['base', 'interior_exterior', 'option'],
      auto_price_sections: ['base', 'interior_exterior', 'option'],
    };
    const taxRule: PricingTaxRule = { id: 'tax', tax_mode: 'full_single_rate', tax_rate: '0.100000', rounding_mode: 'trunc' };
    const calc = calculateV25Workbench(rule, taxRule, plan.state, [], costs, (id) => id === 'p-wall' ? 'interior_exterior' : undefined);
    expect(calc.error).toBeNull();
    const lines = calc.result?.sections.find((section) => section.code === 'interior_exterior')?.lines ?? [];
    expect(lines.map((line) => line.key)).toEqual(['slot:replacement-1', 'line:legacy-2']);
    expect(lines[0].quantity).toBeUndefined(); // quantity is input-only; result amount is recalculated
    expect(calc.result?.sections.find((section) => section.code === 'interior_exterior')?.subtotal).not.toBeNull();
  });

  it('原価Version／仕様差額Versionが無い場合は旧行を消さない', () => {
    expect(proposal(base, product, { ...costs, currentProduct: {} })).toMatchObject({ ok: false });
    expect(proposal(base, product, { ...costs, currentChoice: {} })).toMatchObject({ ok: false });
    expect(proposal(base, product, { ...costs, currentChoice: { white: 0 } }).ok).toBe(true); // 明示された0円Versionは有効
  });

  it('重複商品・不適合区分・未確認仕様は止める', () => {
    const already = { ...base, slots: [{ key: 'slot-existing', baseline_key: null, option_id: 'p-wall',
      variant_choices: { color: 'white' }, quantity: '4', price_mode: 'auto' as const,
      manual_unit_price: '', slot_code: '', slot_label: '', selectable_option_ids: [] }] };
    expect(proposal(already).ok).toBe(false);
    expect(proposal(base, { ...product, section: 'option' }).ok).toBe(false);
    expect(proposal(base, { ...product, defaultChoices: {} }).ok).toBe(false);
    expect(proposal(base, { ...product, retired: true }).ok).toBe(false);
    expect(proposal(base, { ...product, unavailable: true }).ok).toBe(false);
  });

  it('見直し済み・対象外の工事明細は勝手に商品行へ変更しない', () => {
    expect(planLegacyLineReplacement(base, 'legacy-2', product, [product], costs, 'new').ok).toBe(false);
    const sitework = {
      ...base, lines: base.lines.map((line) => line.key === 'legacy-1'
        ? { ...line, section_code: 'sitework' as const } : line),
    };
    expect(proposal(sitework).ok).toBe(false);
    expect(planLegacyLineReplacement(base, 'missing-key', product, [product], costs, 'new').ok).toBe(false);
  });
});
