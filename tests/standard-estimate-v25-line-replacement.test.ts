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
  planLegacyLineReplacement(state, 'legacy-1', candidate, [product, candidate], overrideCosts, 'c-wall', 'replacement-1');

describe('旧明細1行の安全な商品置換案（UI stateのみ、DB操作なし）', () => {
  it('画像付きの商品選択で指定した仕様を置換先にそのまま保持する', () => {
    const variant = { ...product,
      variantGroups: [{ id: 'color', name: '色', choices: [{ id: 'white', name: '白' }, { id: 'black', name: '黒' }] }],
    };
    const setCosts = { ...costs, currentChoice: { white: 0, black: 150 } };
    const result = planLegacyLineReplacement(base, 'legacy-1', variant, [variant], setCosts,
      'c-wall', 'new-choice', undefined, { color: 'black' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newSlot.variant_choices.color).toBe('black');
    expect(buildV25SavePayload(result.state).slots[0].variant_choice_ids).toEqual(['black']);
    expect(planLegacyLineReplacement(base, 'legacy-1', variant, [variant], setCosts,
      'c-wall', 'no-choice', undefined, { color: '' }).ok).toBe(false);
  });


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
    expect(lines[0].amount).toBeGreaterThan(0); // 新しい商品・数量による試算
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

  it('旧明細のカテゴリーを推測せず、担当者の指定と選択商品が一致しない場合は停止する', () => {
    expect(planLegacyLineReplacement(base, 'legacy-1', product, [product], costs, '', 'new')).toMatchObject({ ok: false });
    expect(planLegacyLineReplacement(base, 'legacy-1', product, [product], costs, 'unrelated-category', 'new')).toMatchObject({ ok: false });
    const saved = planLegacyLineReplacement(base, 'legacy-1', product, [product], costs, 'c-wall', 'new');
    expect(saved.ok).toBe(true);
    const unsaved = {
      ...base, lines: base.lines.map((line) => line.key === 'legacy-1'
        ? { ...line, line_key: null } : line),
    };
    expect(planLegacyLineReplacement(unsaved, 'legacy-1', product, [product], costs, 'c-wall', 'new').ok).toBe(false);
  });

  it('同じサッシ商品を寝室窓・洗面窓で使い分け、既存枠・旧行と保存payloadの整合を維持する', () => {
    const sash: V25WorkbenchCandidate = {
      id: 'p-window', name: 'サッシ', section: 'interior_exterior',
      categoryId: 'c-window', categoryName: 'サッシ', categoryCode: 'sash',
      singleSelect: true, manufacturer: 'メーカー', modelNo: 'W-2',
      variantGroups: [], defaultChoices: {},
    };
    const sashCosts = { ...costs, currentProduct: { ...costs.currentProduct, 'p-window': 20000 } };
    const priorSlot = {
      key: 'slot-bedroom', baseline_key: 'old-bedroom', option_id: 'p-window', variant_choices: {},
      quantity: '1', price_mode: 'auto' as const, manual_unit_price: '',
      slot_code: 'bedroom-window', slot_label: '寝室窓', selectable_option_ids: [],
    };
    const withPosition: V25EditorState = { ...base, slots: [priorSlot] };
    const plan = planLegacyLineReplacement(
      withPosition, 'legacy-1', sash, [sash], sashCosts, 'c-window', 'slot-washroom',
      { slot_code: 'washroom-window', slot_label: '洗面窓' },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.state.lines.map((line) => line.key)).toEqual(['legacy-2']);
    expect(plan.state.slots.map((slot) => [slot.option_id, slot.slot_code])).toEqual([
      ['p-window', 'bedroom-window'], ['p-window', 'washroom-window'],
    ]);
    const payload = buildV25SavePayload(plan.state);
    expect(payload.slots.map((slot) => [slot.option_id, slot.slot_code, slot.slot_label, slot.quantity])).toEqual([
      ['p-window', 'bedroom-window', '寝室窓', '1'],
      ['p-window', 'washroom-window', '洗面窓', '1'],
    ]);
    expect(payload.lines.map((line) => line.line_key)).toEqual(['old-2']);

    // 同一商品・同一位置は不可。カテゴリー単位の枠との混在も不可。
    expect(planLegacyLineReplacement(withPosition, 'legacy-1', sash, [sash], sashCosts, 'c-window',
      'dup', { slot_code: 'bedroom-window', slot_label: '寝室窓2' }).ok).toBe(false);
    expect(planLegacyLineReplacement(withPosition, 'legacy-1', sash, [sash], sashCosts, 'c-window',
      'dup-label', { slot_code: 'extra-window', slot_label: '寝室窓' }).ok).toBe(false);
    expect(planLegacyLineReplacement(withPosition, 'legacy-1', sash, [sash], sashCosts, 'c-window',
      'missing-position').ok).toBe(false);
    const categorySlot = { ...priorSlot, slot_code: '', slot_label: '' };
    expect(planLegacyLineReplacement({ ...base, slots: [categorySlot] }, 'legacy-1', sash, [sash],
      sashCosts, 'c-window', 'mixed', { slot_code: 'washroom-window', slot_label: '洗面窓' }).ok).toBe(false);
    expect(planLegacyLineReplacement(base, 'legacy-1', product, [product], costs, 'c-wall', 'wall-position',
      { slot_code: 'front', slot_label: '正面' }).ok).toBe(false);
  });

  it('位置識別子と位置名の両方を求め、DB同様の書式制約を検査する', () => {
    const sash: V25WorkbenchCandidate = {
      ...product, id: 'p-window', categoryId: 'c-window',
      categoryCode: 'sash', categoryName: 'サッシ', singleSelect: false,
    };
    const sashCosts = { ...costs, currentProduct: { ...costs.currentProduct, 'p-window': 20000 } };
    const propose = (slot_code: string, slot_label: string) =>
      planLegacyLineReplacement(base, 'legacy-1', sash, [sash], sashCosts, 'c-window', 'slot-new',
        { slot_code, slot_label });
    expect(propose('', '寝室窓').ok).toBe(false);
    expect(propose('bedroom-window', '').ok).toBe(false);
    expect(propose('Bedroom Window', '寝室窓').ok).toBe(false);
    expect(propose('bedroom-window', '寝室窓').ok).toBe(true);
  });

  it('円単位の計算：手動旧行→標準原価商品、数量・税率・丸め・調整額を独立期待値と照合する', () => {
    const input: V25EditorState = {
      ...base, sales_fee_rate: '1', expense_rate: '0', markup_rate: '1',
      adjustment: '7', adjustment_reason: '端数の補正',
    };
    const plan = proposal(input);
    if (!plan.ok) throw Error(plan.error);
    const rule: PricingCalculationRule = {
      id: 'rule', formula_code: 'v2.5', rounding_mode: 'trunc',
      expense_target_sections: ['base', 'interior_exterior', 'option'],
      auto_price_sections: ['base', 'interior_exterior', 'option'],
    };
    const taxRule: PricingTaxRule = { id: 'tax', tax_mode: 'full_single_rate', tax_rate: '0.100000', rounding_mode: 'trunc' };
    const result = calculateV25Workbench(rule, taxRule, plan.state, [], costs,
      (id) => id === 'p-wall' ? 'interior_exterior' : undefined);
    // 商品標準原価1,000円 × 外壁4面 + 手動10,000円 = 14,000円
    // 調整+7円後の税額 trunc(14,007×10%)=1,400円、税込15,407円
    expect(result.error).toBeNull();
    expect(result.result?.subtotal).toBe(14000);
    expect(result.result?.tax).toBe(1400);
    expect(result.result?.total).toBe(15407);
    expect(buildV25SavePayload(plan.state).adjustment).toBe(7);
  });

  it.each([
    { name: '選択肢原価差額マイナス', adjustment: -103, saleUnit: 16045, expense: 3906, subtotal: 29951, tax: 2993, total: 32927 },
    { name: '選択肢原価差額プラス', adjustment: 37, saleUnit: 16270, expense: 3940, subtotal: 30210, tax: 3019, total: 33212 },
  ])('複合率・選択肢差額・端数：$name を独立期待金額と比較する', ({
    adjustment, saleUnit, expense, subtotal, tax, total,
  }) => {
    const candidate: V25WorkbenchCandidate = {
      id: 'p-sash', name: '窓サッシ', section: 'interior_exterior',
      categoryId: 'c-sash', categoryName: 'サッシ', categoryCode: 'sash',
      singleSelect: false, manufacturer: 'メーカー', modelNo: 'W-11',
      variantGroups: [{ id: 'glass', name: 'ガラス', choices: [{ id: 'glass-a', name: '標準' }] }],
      defaultChoices: { glass: 'glass-a' },
    };
    const choiceCosts: V25WorkbenchCosts = {
      pinned: {}, currentProduct: { 'p-sash': 10101 }, currentChoice: { 'glass-a': adjustment },
    };
    const input: V25EditorState = {
      ...base, sales_fee_rate: '1.07', expense_rate: '0.15', markup_rate: '1.5',
      adjustment: '-17', adjustment_reason: '現場の調整',
    };
    const plan = planLegacyLineReplacement(input, 'legacy-1', candidate, [candidate], choiceCosts,
      'c-sash', 'sash-new', { slot_code: 'washroom-window', slot_label: '洗面窓' });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const rule: PricingCalculationRule = {
      id: 'rule', formula_code: 'v2.5', rounding_mode: 'trunc',
      expense_target_sections: ['base', 'interior_exterior', 'option'],
      auto_price_sections: ['base', 'interior_exterior', 'option'],
    };
    const taxRule: PricingTaxRule = {
      id: 'tax', tax_mode: 'full_single_rate', tax_rate: '0.100000', rounding_mode: 'trunc',
    };
    const result = calculateV25Workbench(rule, taxRule, plan.state, [], choiceCosts,
      (id) => id === candidate.id ? 'interior_exterior' : undefined);
    expect(result.error).toBeNull();
    const section = result.result?.sections.find((item) => item.code === 'interior_exterior');
    // 原価 10,101円 + 選択肢差額 → 販売費1.07を切捨 → 掛率1.5を切捨。
    // 旧明細1行は除外、新商品と保持する手動行10,000円だけを計上。
    expect(section?.lines.map((item) => item.key)).toEqual(['slot:sash-new', 'line:legacy-2']);
    expect(section?.lines[0].sale_unit_price).toBe(saleUnit);
    expect(section?.priced_subtotal).toBe(saleUnit + 10000);
    expect(section?.expense).toBe(expense);
    expect(section?.total).toBe(subtotal);
    // 調整額-17円、10%税の円未満切捨、税込合計まで独立期待値と照合。
    expect(result.result?.subtotal).toBe(subtotal);
    expect(result.result?.adjusted_subtotal).toBe(subtotal - 17);
    expect(result.result?.tax).toBe(tax);
    expect(result.result?.total).toBe(total);
    expect(buildV25SavePayload(plan.state).slots[0]).toMatchObject({
      option_id: 'p-sash', variant_choice_ids: ['glass-a'],
      slot_code: 'washroom-window', slot_label: '洗面窓',
    });
  });

  it('PORの旧明細は0円扱いにせず、置換できても画面側の未確定金額確認が必要', () => {
    const porState: V25EditorState = {
      ...base, lines: base.lines.map((line) => line.key === 'legacy-1'
        ? { ...line, price_mode: 'por' as const, unit_price: '' } : line),
    };
    const plan = proposal(porState);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(porState.lines[0].price_mode).toBe('por');
    expect(plan.state.lines.map((line) => line.key)).toEqual(['legacy-2']);
  });

  it('見直し済み・対象外の工事明細は勝手に商品行へ変更しない', () => {
    expect(planLegacyLineReplacement(base, 'legacy-2', product, [product], costs, 'c-wall', 'new').ok).toBe(false);
    const sitework = {
      ...base, lines: base.lines.map((line) => line.key === 'legacy-1'
        ? { ...line, section_code: 'sitework' as const } : line),
    };
    expect(proposal(sitework).ok).toBe(false);
    expect(planLegacyLineReplacement(base, 'missing-key', product, [product], costs, 'c-wall', 'new').ok).toBe(false);
  });
});
