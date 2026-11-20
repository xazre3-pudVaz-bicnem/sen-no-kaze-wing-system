import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PricingCalculationRule, PricingTaxRule } from '@/lib/domain/pricing-v25';
import { buildV25SavePayload, type V25EditorState, type V25LineRow, type V25SlotRow } from '@/lib/domain/standard-estimate-v25-view';
import type { V25WorkbenchCandidate } from '@/lib/domain/standard-estimate-v25-workbench';
import {
  v25AutoWorkItemLabel,
  v25RenameWorkGroup,
  v25WorkGroupNameError,
  v25WorkGroupsForDisplay,
  v25WorkItemLabelsForSection,
} from '@/components/admin/standard-estimate-v25-work-groups';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/standard-estimate-v25', () => ({
  saveStandardEstimateV25DraftAction: vi.fn(),
  refreshStandardEstimateV25CostsAction: vi.fn(),
  publishStandardEstimateV25RevisionAction: vi.fn(),
}));
const { StandardEstimateV25Workbench } = await import('@/components/admin/standard-estimate-v25-workbench');

// Excel風明細の商品の行の工事項目（自動の値・移動による更新・保存）の画面
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\r').join('');

const slot = (key: string, optionId: string, extra: Partial<V25SlotRow> = {}): V25SlotRow => ({
  key, baseline_key: null, option_id: optionId, variant_choices: {}, quantity: '1', price_mode: 'auto', manual_unit_price: '',
  slot_code: '', slot_label: '', selectable_option_ids: [], ...extra,
});
const line = (key: string, extra: Partial<V25LineRow> = {}): V25LineRow => ({
  key, line_key: null, section_code: 'interior_exterior', group_label: '', name: key, quantity: '1', unit: '式',
  price_mode: 'manual', unit_price: '1000', remark: '', review_required: false, ...extra,
});
const state = (slots: V25SlotRow[], lines: V25LineRow[]): V25EditorState => ({
  sales_fee_rate: '1', markup_rate: '1.5', expense_rate: '0.15', adjustment: '0', adjustment_reason: '', slots, lines,
});
const context = { modelSlug: 'wing-01', specCode: 'hotel' };

describe('工事項目の自動の値と選択肢', () => {
  it('商品台帳のカテゴリーから自動の値（分類できないカテゴリー・別途工事は空）', () => {
    expect(v25AutoWorkItemLabel('roof', { ...context, sectionCode: 'interior_exterior' })).toBe('2. 屋根工事');
    expect(v25AutoWorkItemLabel('sash', { ...context, sectionCode: 'interior_exterior' })).toBe('1. サッシ・木製建具工事');
    expect(v25AutoWorkItemLabel('kitchen', { ...context, sectionCode: 'option' })).toBe('1. 設備機器');
    expect(v25AutoWorkItemLabel('lighting', { ...context, sectionCode: 'option' })).toBe('');
    expect(v25AutoWorkItemLabel('roof', { ...context, sectionCode: 'sitework' })).toBe('');
    // モデル・仕様が分からないオプションは分類しない
    expect(v25AutoWorkItemLabel('kitchen', { sectionCode: 'option' })).toBe('');
  });

  it('分類の候補は区分・モデル・仕様ごと（Excel の標準見積）', () => {
    expect(v25WorkItemLabelsForSection({ ...context, sectionCode: 'interior_exterior' })).toEqual([
      '1. サッシ・木製建具工事', '2. 屋根工事', '3. 外壁工事', '4. 内装仕上げ',
    ]);
    expect(v25WorkItemLabelsForSection({ ...context, sectionCode: 'option' })).toEqual([
      '1. 設備機器', '2. その他の設備', '3. 各種養生（床養生マット、壁ビニールシート等）',
    ]);
    expect(v25WorkItemLabelsForSection({ ...context, sectionCode: 'sitework' })).toEqual([]);
  });
});

describe('工事項目の見出しの分け方', () => {
  const categoryOf = (id: string) => ({ roof1: 'roof', roof2: 'roof', roof3: 'roof', sash1: 'sash' } as Record<string, string>)[id];

  it('保存した工事項目があればそれで、無ければカテゴリーで。分類に無い名前は同じ名前の手入力と同じ見出し', () => {
    const groups = v25WorkGroupsForDisplay(
      [slot('s1', 'roof1', { work_item: '1. サッシ・木製建具工事' }), slot('s2', 'roof2'), slot('s3', 'roof3', { work_item: '屋根の付帯工事' })],
      [line('l1', { group_label: '屋根の付帯工事' })],
      categoryOf,
      (row) => row.group_label,
      { ...context, sectionCode: 'interior_exterior' }
    );
    expect(groups.map((group) => [group.label, group.slots.map((row) => row.key), group.lines.map((row) => row.key)])).toEqual([
      ['1. サッシ・木製建具工事', ['s1'], []],
      ['2. 屋根工事', ['s2'], []],
      ['屋根の付帯工事', ['s3'], ['l1']],
    ]);
  });

  it('工事項目の無い行（今までの下書き）は、今までどおりカテゴリーで分ける', () => {
    const groups = v25WorkGroupsForDisplay([slot('s1', 'roof1'), slot('s2', 'sash1')], [], categoryOf, (row) => row.group_label,
      { ...context, sectionCode: 'interior_exterior' });
    expect(groups.map((group) => [group.label, group.slots.map((row) => row.key)])).toEqual([
      ['1. サッシ・木製建具工事', ['s2']],
      ['2. 屋根工事', ['s1']],
    ]);
  });
});

describe('工事項目の見出し単位の追加と名称編集', () => {
  const scope = { ...context, sectionCode: 'interior_exterior' as const };
  const categoryOf = (id: string) => ({ roof1: 'roof', sash1: 'sash' } as Record<string, string>)[id];

  it('商品と手入力行の見出し名を一括変更するが、数量・単価・位置・ID・別の区分は変更しない', () => {
    const before = state(
      [slot('s1', 'roof1', { quantity: '23.5', slot_code: '', work_item: '' }),
       slot('s2', 'sash1', { quantity: '1', work_item: '1. サッシ・木製建具工事' })],
      [line('l1', { group_label: '2. 屋根工事', quantity: '3', unit_price: '1200' }),
       line('l2', { section_code: 'option', group_label: '2. 屋根工事' })]
    );
    const groups = v25WorkGroupsForDisplay(
      before.slots.filter((item) => item.option_id === 'roof1'),
      before.lines.filter((item) => item.section_code === 'interior_exterior'),
      categoryOf, (row) => row.group_label, scope
    );
    const roof = groups.find((item) => item.key === 'work:roof');
    expect(roof).toBeDefined();
    const after = v25RenameWorkGroup(before, roof!, '2. 屋根・板金工事');
    expect(after.slots[0]).toEqual({ ...before.slots[0], work_item: '2. 屋根・板金工事' });
    expect(after.lines[0]).toEqual({ ...before.lines[0], group_label: '2. 屋根・板金工事' });
    expect(after.slots[1]).toEqual(before.slots[1]);
    expect(after.lines[1]).toEqual(before.lines[1]);
    expect(before.slots[0].work_item).toBe('');
    expect(buildV25SavePayload(after).slots[0].work_item).toBe('2. 屋根・板金工事');
    expect(buildV25SavePayload(after).lines[0].group_label).toBe('2. 屋根・板金工事');
    const renamed = v25WorkGroupsForDisplay(
      after.slots.filter((item) => item.option_id === 'roof1'),
      after.lines.filter((item) => item.section_code === 'interior_exterior'),
      categoryOf, (row) => row.group_label, scope
    );
    expect(renamed.find((group) => group.label === '2. 屋根・板金工事')).toMatchObject({
      slots: [{ key: 's1' }], lines: [{ key: 'l1' }],
    });
  });

  it('保存行順が分かる工事項目は、名前を変更しても同じ表示位置を維持する', () => {
    const before = state(
      [slot('sash', 'sash1', { row_order: 1 }),
       slot('roof', 'roof1', { row_order: 2, work_item: '2. 屋根工事' })],
      [line('l-roof', { group_label: '2. 屋根工事', row_order: 3 }),
       line('l-other', { group_label: '4. 内装仕上げ', row_order: 4 })]
    );
    const toGroups = (input: V25EditorState) =>
      v25WorkGroupsForDisplay(input.slots, input.lines, categoryOf, (line) => line.group_label, scope);
    const roof = toGroups(before).find((group) => group.key === 'work:roof')!;
    const after = v25RenameWorkGroup(before, roof, '2. 屋根・板金工事');
    expect(toGroups(before).map((group) => group.label)).toEqual([
      '1. サッシ・木製建具工事', '2. 屋根工事', '4. 内装仕上げ',
    ]);
    expect(toGroups(after).map((group) => group.label)).toEqual([
      '1. サッシ・木製建具工事', '2. 屋根・板金工事', '4. 内装仕上げ',
    ]);
    expect(after.slots[1].row_order).toBe(2);
    expect(after.lines[0].row_order).toBe(3);
  });

  it('空見出しではなく手入力行を同時追加し、品名を埋めれば既存の保存payloadに入る', () => {
    const newLine = line('new', { group_label: '5. 造作工事', name: '', price_mode: 'por', unit_price: '' });
    const before = state([], []);
    const added = { ...before, lines: [newLine] };
    const groups = v25WorkGroupsForDisplay([], added.lines, () => null, (row) => row.group_label, scope);
    expect(groups.map((group) => group.label)).toEqual(['5. 造作工事']);
    expect(v25WorkGroupNameError('5. 造作工事', [], scope)).toBeNull();
    expect(buildV25SavePayload(added).lines[0]).toMatchObject({
      group_label: '5. 造作工事', price_mode: 'por',
    });
    expect(added.lines[0].name).toBe('');
  });

  it('空・長すぎる名称・既存名称との重複・未分類表示用名称を拒否する', () => {
    const groups = v25WorkGroupsForDisplay(
      [slot('roof', 'roof1')], [line('manual', { group_label: '5. 造作工事' })],
      categoryOf, (row) => row.group_label, scope
    );
    expect(v25WorkGroupNameError('  ', groups, scope)).toContain('入力');
    expect(v25WorkGroupNameError('長'.repeat(121), groups, scope)).toContain('120文字');
    expect(v25WorkGroupNameError('2. 屋根工事', groups, scope)).toContain('すでに');
    expect(v25WorkGroupNameError('5. 造作工事', groups, scope)).toContain('すでに');
    expect(v25WorkGroupNameError('工事項目未分類の商品', groups, scope)).toContain('予約');
    expect(v25WorkGroupNameError('2. 屋根工事', groups, scope, 'work:roof')).toBeNull();
    expect(v25WorkGroupNameError('2.屋根工事', groups, scope, 'work:roof')).toContain('標準');
  });
});

describe('保存（工事項目は送り、並び順は送らない）', () => {
  it('工事項目を送り、並び順は送らない（見積書の明細は今までどおりの順。見出しは画面の表示だけ）', () => {
    const before = state(
      [slot('k', 'kitchen1', { work_item: '1. 設備機器' }), slot('r', 'roof1', { work_item: '2. 屋根工事' })],
      [line('l-roof', { group_label: '2. 屋根工事', unit_price: '3000' })]
    );
    const payload = buildV25SavePayload(before);
    expect(payload.slots.map((row) => [row.option_id, row.work_item, row.row_order])).toEqual([['kitchen1', '1. 設備機器', null], ['roof1', '2. 屋根工事', null]]);
    expect(payload.lines.map((row) => [row.name, row.group_label, row.row_order, row.unit_price])).toEqual([['l-roof', '2. 屋根工事', null, 3000]]);
  });
});

describe('画面の描画（工事項目は表示のみ、移動で変更）', () => {
  const rule: PricingCalculationRule = {
    id: 'rule-1', formula_code: 'v2.5', rounding_mode: 'trunc',
    expense_target_sections: ['base', 'interior_exterior', 'option'], auto_price_sections: ['base', 'interior_exterior', 'option'],
  };
  const taxRule: PricingTaxRule = { id: 'tax-1', tax_mode: 'full_single_rate', tax_rate: '0.100000', rounding_mode: 'trunc' };
  const candidate = (id: string, name: string, categoryCode: string, section: V25LineRow['section_code']): V25WorkbenchCandidate => ({
    id, name, categoryId: `cat-${categoryCode}`, categoryName: categoryCode, categoryCode, singleSelect: false,
    manufacturer: '', modelNo: '', section, variantGroups: [], defaultChoices: {},
  });
  const candidates = [
    candidate('roof1', '屋根材', 'roof', 'interior_exterior'),
    candidate('sash1', 'サッシ', 'sash', 'interior_exterior'),
    candidate('light1', '照明', 'lighting', 'option'),
  ];
  const render = (readOnly: boolean, initial: V25EditorState) =>
    renderToStaticMarkup(createElement(StandardEstimateV25Workbench, {
      resetKey: 'r:1', revisionId: '00000000-0000-4000-8000-000000000001', lockVersion: 1, readOnly,
      modelSlug: 'wing-01', specCode: 'hotel',
      baseLines: [], candidates, initial,
      costs: { pinned: {}, currentProduct: { roof1: 1000, sash1: 1000, light1: 1000 }, currentChoice: {} },
      rule, taxRule, preview: null, savedTotal: null,
    }));
  it('商品行の重複工事項目ラベルはなくし、旧下書きの工事項目見出し・自動分類の案内を維持', () => {
    const html = render(false, state([slot('a', 'roof1'), slot('b', 'light1')], [
      line('l', { section_code: 'option', group_label: '照明工事' }),
    ]));
    expect(html).toContain('data-testid="v25-work-item-heading"');
    expect(html).toContain('>2. 屋根工事</span>');
    expect(html).not.toContain('data-testid="v25-wb-slot-work-item"');
    expect(html).not.toContain('data-testid="v25-wb-slot-work-item-label"');
    expect(html).not.toContain('data-testid="v25-wb-slot-work-item-select"');
    expect(html).toContain('data-testid="v25-wb-work-item-auto-unsaved"');
    expect(html).toContain('工事項目が未設定の商品 1 件は');
    expect((html.match(/data-testid="v25-wb-slot"/g) ?? []).length).toBe(2);
  });

  it('保存済み工事項目は小見出しに残し、商品行では繰り返さない', () => {
    const html = render(false, state([slot('a', 'roof1', { work_item: '3. 外壁工事' })], []));
    expect(html).toContain('>3. 外壁工事</span>');
    expect(html).not.toContain('data-testid="v25-wb-slot-work-item');
    expect(html).not.toContain('data-testid="v25-wb-work-item-auto-unsaved"');
  });

  it('公開済みreadOnlyでも重複ラベルを出さず、見出し・商品・数量表示は維持', () => {
    const html = render(true, state([slot('a', 'roof1'), slot('b', 'sash1', { work_item: '1. サッシ・木製建具工事' })], []));
    expect(html).toContain('data-testid="v25-work-item-heading"');
    expect(html).toContain('>1. サッシ・木製建具工事</span>');
    expect(html).not.toContain('data-testid="v25-wb-slot-work-item');
    expect(html).toContain('data-testid="v25-wb-slot-unit"');
    expect(html).not.toContain('data-testid="v25-wb-work-item-auto-unsaved"');
  });

});

describe('画面（Excel 風明細）', () => {
  const workbench = read('components/admin/standard-estimate-v25-workbench.tsx');

  it('商品行での表示を削除しても、工事項目の所属・移動・手動変更入口と自動分類を維持', () => {
    expect(workbench).not.toContain('data-testid="v25-wb-slot-work-item-select"');
    expect(workbench).not.toContain('data-testid="v25-wb-slot-work-item-label"');
    expect(workbench).not.toContain('data-testid="v25-wb-slot-work-item"');
    expect(workbench).toContain('data-testid="v25-work-item-heading"');
    expect(workbench).toContain('data-testid="v25-wb-edit-work-group"');
    expect(workbench).toContain('data-testid={`v25-wb-add-work-group-${code}`}');
    expect(workbench).not.toContain('data-testid="v25-wb-change-work-group"');
    expect(workbench).toContain('const workItemOf = (slot: V25SlotRow) => slot.work_item?.trim() || autoWorkItemOf(slot);');
    expect(workbench).toContain("if (readOnly) return '';");
    expect(workbench).toContain('v25PlanMixedRowMove(');
  });

  it('見出しの分け方と保存は同じ工事項目（表示の値）を使う。混在の保存順を全行に付ける', () => {
    expect(workbench).toContain("(line) => line.group_label, { modelSlug, specCode, sectionCode: code },\n                workItemOf,");
    expect(workbench).toContain('const toSave: V25EditorState = { ...state, slots: state.slots.map((slot) => ({ ...slot, work_item: workItemOf(slot) })) };');
    expect(workbench).toContain('const orderedToSave = v25WithRowOrder(toSave, renderedMixedOrder);');
    expect(workbench).toContain('payload: buildV25SavePayload(orderedToSave)');
    expect(workbench).not.toContain('buildV25SavePayload(v25WithRowOrder(');
  });

  it('自動の値がまだ保存されていない行は未保存として扱い（保存するまで公開しない）、案内を出す。「変更を破棄」は手で変えた分だけ', () => {
    expect(workbench).toContain('const unsavedAutoWorkItems = state.slots.filter((slot) => !slot.work_item?.trim() && autoWorkItemOf(slot)).length;');
    expect(workbench).toContain('const dirty = editedDirty || unsavedAutoWorkItems > 0 || orderDirty;');
    expect(workbench).toContain('data-testid="v25-wb-work-item-auto-unsaved"');
    expect(workbench).toContain('disabled={pending || (!editedDirty && !orderDirty) || positionInputActive} onClick={() => {\n              setState(initial);');
  });

  it('新しく選んだ商品は未設定から始め（表示・保存はカテゴリーからの自動の値）、同じカテゴリーへの入れ替えは工事項目を変えない', () => {
    expect(workbench).toContain("            work_item: '',");
    expect(workbench).toContain('// 入れ替えは数量・位置・行順・工事項目を保持。変更候補だけ同カテゴリに整理する。');
  });
});
