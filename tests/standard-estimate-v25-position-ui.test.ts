import { describe, expect, it } from 'vitest';
import { buildV25SavePayload, validateV25EditorState, type V25EditorState } from '@/lib/domain/standard-estimate-v25-view';
import { calculateV25Workbench, type V25WorkbenchCandidate, type V25WorkbenchCosts } from '@/lib/domain/standard-estimate-v25-workbench';
import type { PricingCalculationRule, PricingTaxRule } from '@/lib/domain/pricing-v25';
import {
  addV25PositionRow, clearV25Position, nextV25PositionCode, renameV25Position,
  replaceV25PositionStandard, updateV25Position, v25PositionMixes, v25PositionNameKeyAction,
} from '@/lib/domain/standard-estimate-v25-position-ui';

const products: V25WorkbenchCandidate[] = [
  { id: 's1', name: 'サッシA', categoryId: 'sash-cat', categoryName: 'サッシ', categoryCode: 'sash', singleSelect: false, priceUnit: '本',
    section: 'option', manufacturer: '', modelNo: '', variantGroups: [], defaultChoices: {} },
  { id: 's2', name: 'サッシB', categoryId: 'sash-cat', categoryName: 'サッシ', categoryCode: 'sash', singleSelect: false, priceUnit: '本',
    section: 'option', manufacturer: '', modelNo: '', variantGroups: [], defaultChoices: {} },
  { id: 's3', name: '販売停止商品', retired: true, categoryId: 'sash-cat', categoryName: 'サッシ', categoryCode: 'sash', singleSelect: false,
    section: 'option', manufacturer: '', modelNo: '', variantGroups: [], defaultChoices: {} },
  { id: 'door', name: '玄関ドア', categoryId: 'door-cat', categoryName: '玄関', categoryCode: 'door', singleSelect: false,
    section: 'option', manufacturer: '', modelNo: '', variantGroups: [], defaultChoices: {} },
  { id: 'wall', name: '外壁', categoryId: 'wall-cat', categoryName: '外壁', categoryCode: 'exterior-wall', singleSelect: false,
    section: 'interior_exterior', manufacturer: '', modelNo: '', variantGroups: [], defaultChoices: {} },
];
const get = (id: string) => products.find((product) => product.id === id);
const row = (key: string, override: Partial<V25EditorState['slots'][number]> = {}): V25EditorState['slots'][number] => ({
  key, baseline_key: key, option_id: 's1', variant_choices: {}, quantity: '1', price_mode: 'auto',
  manual_unit_price: '', slot_code: '', slot_label: '', selectable_option_ids: [], ...override,
});
const state = (slots: V25EditorState['slots']): V25EditorState => ({
  sales_fee_rate: '1.07', markup_rate: '1.5', expense_rate: '0.15', adjustment: '0', adjustment_reason: '',
  slots, lines: [],
});
const costs: V25WorkbenchCosts = {
  pinned: { 's1|': { standard_cost: 100_000, variant_adjustments: {} } },
  currentProduct: { s1: 100_000, s2: 130_000, door: 40_000 },
  currentChoice: {},
};
const rule: PricingCalculationRule = {
  id: 'rule', formula_code: 'v2.5', rounding_mode: 'trunc',
  expense_target_sections: ['base', 'interior_exterior', 'option'],
  auto_price_sections: ['base', 'interior_exterior', 'option'],
};
const taxRule: PricingTaxRule = { id: 'tax', tax_mode: 'full_single_rate', tax_rate: '0.100000', rounding_mode: 'trunc' };
const total = (editor: V25EditorState) =>
  calculateV25Workbench(rule, taxRule, editor, [], costs, (id) => get(id)?.section).result?.total;

describe('標準見積v2.5 位置別設定：編集中の原子的な操作', () => {
  it('識別子はUUID由来で、削除済みの連番を再利用せず40字以内の形式を守る', () => {
    const deleted = 'position-1';
    const newCode = nextV25PositionCode([row('one', { slot_code: 'living' })],
      () => '12345678-1234-4123-8123-123456789abc');
    expect(newCode).toBe('p-12345678123441238123123456789abc');
    expect(newCode).not.toBe(deleted);
    expect(newCode).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
    expect(newCode.length).toBeLessThanOrEqual(40);
    const duplicate = 'p-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa';
    const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    const distinct = nextV25PositionCode([row('same', { slot_code: duplicate })], () => ids.shift()!);
    expect(distinct).toBe('p-bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb');
    // 同じ残存行から発行しても連番と異なり、削除済みコードへの自動巻き戻りはない。
    const fresh = nextV25PositionCode([]);
    expect(fresh).toMatch(/^p-[a-f0-9]{32}$/);
    expect(fresh).not.toBe(deleted);
  });
  it('既存行の位置付けと表示名の修正は1行のまま。商品・数量・価格・識別子は変わらない', () => {
    const before = state([row('a')]);
    const beforePrice = total(before);
    const tagged = updateV25Position(before, 'a', 'リビングの掃出し窓', ['s2'], get);
    expect(tagged.error).toBeNull();
    expect(tagged.state.slots).toHaveLength(1);
    expect(tagged.state.slots[0]).toMatchObject({
      key: 'a', baseline_key: 'a', option_id: 's1', quantity: '1', slot_code: expect.stringMatching(/^p-[a-f0-9]{32}$/),
      slot_label: 'リビングの掃出し窓', selectable_option_ids: ['s2'],
    });
    const renamed = updateV25Position(tagged.state, 'a', '居間の掃出し窓', ['s2'], get);
    expect(renamed.state.slots[0].slot_code).toBe(tagged.state.slots[0].slot_code);
    expect(renamed.state.slots[0].variant_choices).toEqual(before.slots[0].variant_choices);
    expect(renamed.state.slots[0].price_mode).toBe(before.slots[0].price_mode);
    expect(total(tagged.state)).toBe(beforePrice);
    expect(total(renamed.state)).toBe(beforePrice);
    expect(buildV25SavePayload(renamed.state).slots[0].slot_code).toBe(tagged.state.slots[0].slot_code);
    expect(validateV25EditorState(renamed.state, (id) => get(id)?.section)).toBeNull();
    expect(before.slots[0].slot_code).toBe('');
  });
  it('位置名の直接編集はラベル以外を一切変更しない。保存payload・金額・候補も不変', () => {
    const original = state([
      row('a', { slot_code: 'living', slot_label: 'リビングの窓', selectable_option_ids: ['s2'],
        variant_choices: { color: 'white' }, price_mode: 'manual', manual_unit_price: '165000' }),
      row('b', { slot_code: 'sleeping', slot_label: '寝室の窓' }),
    ]);
    const oldPrice = total(original);
    const renamed = renameV25Position(original, 'a', '  居間の窓  ', get);
    expect(renamed.error).toBeNull();
    expect(renamed.state.slots).toHaveLength(2);
    expect(renamed.state.slots[0]).toEqual({ ...original.slots[0], slot_label: '居間の窓' });
    expect(renamed.state.slots[1]).toEqual(original.slots[1]);
    expect(renamed.state.slots[0].slot_code).toBe('living');
    expect(renamed.state.slots[0].selectable_option_ids).toEqual(['s2']);
    expect(total(renamed.state)).toBe(oldPrice);
    expect(buildV25SavePayload(renamed.state).slots[0].slot_code).toBe('living');
    expect(original.slots[0].slot_label).toBe('リビングの窓');
    // 既存の変更候補が販売停止になっていても、位置名だけの編集は妨げない。
    const legacy = state([row('a', { slot_code: 'living', slot_label: '旧位置', selectable_option_ids: ['s3'] })]);
    expect(renameV25Position(legacy, 'a', '新位置', get).state.slots[0].selectable_option_ids).toEqual(['s3']);
  });
  it('位置名の空欄・重複・40字超・位置無しを拒否し、stateを維持', () => {
    const original = state([
      row('a', { slot_code: 'living', slot_label: 'リビングの窓' }),
      row('b', { slot_code: 'sleeping', slot_label: '寝室の窓' }),
    ]);
    for (const name of ['', '   ', '寝室の窓', 'あ'.repeat(41)]) {
      const result = renameV25Position(original, 'a', name, get);
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(original);
    }
    expect(renameV25Position(state([row('a')]), 'a', '寝室', get).state.slots[0].slot_code).toBe('');
    expect(renameV25Position(original, 'a', 'リビングの窓', get).state).toBe(original);
  });
  it('日本語IME変換中・変換終了直後のEnterでは編集確定しない', () => {
    expect(v25PositionNameKeyAction('Enter', true, false)).toBeNull();
    expect(v25PositionNameKeyAction('Enter', false, false, 229)).toBeNull();
    expect(v25PositionNameKeyAction('Enter', false, true)).toBeNull();
    expect(v25PositionNameKeyAction('Escape', true, false)).toBeNull();
    expect(v25PositionNameKeyAction('Enter', false, false, 13)).toBe('commit');
    expect(v25PositionNameKeyAction('Escape', false, false)).toBe('cancel');
    expect(v25PositionNameKeyAction('Tab', false, false)).toBeNull();
  });
  it('位置を付けるときに数量1以外、空欄、長すぎる位置名は拒否。自動で数量を変えない', () => {
    const original = state([row('a', { quantity: '2' })]);
    expect(updateV25Position(original, 'a', '洗面室の窓', [], get)).toEqual({
      state: original, error: expect.stringContaining('数量1'),
    });
    expect(updateV25Position(original, 'a', '', [], get)).toEqual({
      state: original, error: expect.stringContaining('位置名'),
    });
    expect(updateV25Position(original, 'a', 'あ'.repeat(41), [], get).state).toBe(original);
    expect(original.slots[0].quantity).toBe('2');
  });
  it('同一商品の別位置追加は直下に1行だけ、数量1、変更候補は選択した分だけ', () => {
    const before = state([row('a', { slot_code: 'living', slot_label: 'リビングの窓', selectable_option_ids: ['s2'] })]);
    const price = total(before);
    const added = addV25PositionRow(before, 'a', 'new-row', '洗面室の窓', [], get);
    expect(added.error).toBeNull();
    expect(added.state.slots).toHaveLength(2);
    expect(added.state.slots[1]).toMatchObject({ key: 'new-row', baseline_key: null, option_id: 's1', quantity: '1',
      slot_label: '洗面室の窓', slot_code: expect.stringMatching(/^p-[a-f0-9]{32}$/), selectable_option_ids: [] });
    expect(added.state.slots[0]).toEqual(before.slots[0]);
    expect(added.state.slots[1].slot_code).not.toBe(before.slots[0].slot_code);
    expect(added.state.slots[1].key).not.toBe(before.slots[0].key);
    expect(total(added.state)).toBeGreaterThan(price!);
    expect(buildV25SavePayload(added.state).slots).toHaveLength(2);
    const copied = addV25PositionRow(before, 'a', 'new-row', '寝室の窓', ['s2'], get);
    expect(copied.state.slots[1].selectable_option_ids).toEqual(['s2']);
  });
  it('重複位置名・不適切な候補・無効な追加元は行を増やさず失敗する', () => {
    const before = state([row('a', { slot_code: 'living', slot_label: 'リビングの窓', selectable_option_ids: ['s2'] })]);
    expect(addV25PositionRow(before, 'a', 'new', 'リビングの窓', [], get).state).toBe(before);
    expect(addV25PositionRow(before, 'a', 'new', '洗面室の窓', ['s3'], get).state).toBe(before);
    expect(addV25PositionRow(before, 'a', 'new', '洗面室の窓', ['door'], get).state).toBe(before);
    expect(addV25PositionRow(state([row('a')]), 'a', 'new', '寝室の窓', [], get).state.slots).toHaveLength(1);
    expect(updateV25Position(state([row('a', { option_id: 'wall', quantity: '4' })]), 'a', '外壁東', [], get).error).toContain('位置');
  });
  it('入替候補は初期空、確認して選んだ分だけ保存候補にし、位置名・識別子・行IDを保持', () => {
    const before = state([row('a', { slot_code: 'living', slot_label: 'リビングの窓', selectable_option_ids: ['s2'] })]);
    const result = replaceV25PositionStandard(before, 'a', get('s2')!, {}, [], get);
    expect(result.error).toBeNull();
    expect(result.state.slots[0]).toMatchObject({ baseline_key: 'a', key: 'a', option_id: 's2',
      slot_code: 'living', slot_label: 'リビングの窓', selectable_option_ids: [] });
    expect(before.slots[0].option_id).toBe('s1');
    // 同じ商品IDで色・仕様だけ選び直す場合は変更候補を保持する。
    const same = replaceV25PositionStandard(before, 'a', get('s1')!, { color: 'white' }, [], get);
    expect(same.error).toBeNull();
    expect(same.state.slots[0]).toMatchObject({
      option_id: 's1', slot_code: 'living', slot_label: 'リビングの窓',
      selectable_option_ids: ['s2'], variant_choices: { color: 'white' },
    });
    expect(before.slots[0].variant_choices).toEqual({});
    const invalid = replaceV25PositionStandard(before, 'a', get('door')!, {}, [], get);
    expect(invalid.state).toBe(before);
    const options = replaceV25PositionStandard(before, 'a', get('s2')!, {}, ['s1'], get);
    expect(options.state.slots[0].selectable_option_ids).toEqual(['s1']);
  });
  it('位置解除は商品行を残し、候補を外す。混在の警告は全行位置設定で消える', () => {
    const mixed = state([
      row('a', { slot_code: 'living', slot_label: 'リビングの窓', selectable_option_ids: ['s2'] }),
      row('b', { slot_code: '', slot_label: '', selectable_option_ids: [] }),
    ]);
    expect(v25PositionMixes(mixed.slots, get)).toMatchObject([
      { categoryName: 'サッシ', total: 2, unsetKeys: ['b'] },
    ]);
    const fixed = updateV25Position(mixed, 'b', '洗面室の窓', [], get);
    expect(v25PositionMixes(fixed.state.slots, get)).toEqual([]);
    // 入力欄の空欄はエラーであり、解除操作を明示したときだけ消せる。
    const blank = updateV25Position(fixed.state, 'a', '', [], get);
    expect(blank.error).toContain('位置名');
    expect(blank.state).toBe(fixed.state);
    expect(blank.state.slots[0].slot_code).toBe('living');
    const cleared = clearV25Position(fixed.state, 'a');
    expect(cleared.error).toBeNull();
    expect(cleared.state.slots).toHaveLength(2);
    expect(cleared.state.slots[0]).toMatchObject({ option_id: 's1', slot_code: '', slot_label: '', selectable_option_ids: [] });
    expect(v25PositionMixes(cleared.state.slots, get)).toHaveLength(1);
    expect(mixed.slots[0].slot_label).toBe('リビングの窓');
  });
});

describe('商品入替時の位置別サッシ数量・販売単位の保護', () => {
  it('同じ単位の別サッシへ変更しても位置・数量1・価格指定を保持し、保存payloadも同じ', () => {
    const before = state([row('window', { slot_code: 'living', slot_label: 'リビング窓', quantity: '1',
      price_mode: 'manual', manual_unit_price: '180000', selectable_option_ids: ['s2'] })]);
    const result = replaceV25PositionStandard(before, 'window', get('s2')!, {}, ['s1'], get);
    expect(result.error).toBeNull();
    expect(result.state.slots[0]).toMatchObject({
      option_id: 's2', slot_code: 'living', slot_label: 'リビング窓', quantity: '1',
      price_mode: 'manual', manual_unit_price: '180000', selectable_option_ids: ['s1'],
    });
    const saved = buildV25SavePayload(result.state).slots[0];
    expect(saved.quantity).toBe('1');
    expect(saved.slot_code).toBe('living');
    expect(saved.option_id).toBe('s2');
    expect(saved.manual_unit_price).toBe(180000);
    expect(validateV25EditorState(result.state, (id) => get(id)?.section)).toBeNull();
  });

  it('位置別サッシの単位不一致・未登録では確定しない', () => {
    const before = state([row('window', { slot_code: 'living', slot_label: '居間の窓', selectable_option_ids: ['s2'] })]);
    const mismatched = { ...get('s2')!, priceUnit: '式' };
    const unknown = { ...get('s2')!, priceUnit: null };
    for (const invalid of [mismatched, unknown]) {
      const result = replaceV25PositionStandard(before, 'window', invalid, {}, [], get);
      expect(result.error).toContain('販売単位');
      expect(result.state).toBe(before);
    }
    const same = replaceV25PositionStandard(before, 'window', get('s1')!, { color: 'black' }, [], get);
    expect(same.error).toBeNull();
    expect(same.state.slots[0]).toEqual({ ...before.slots[0], variant_choices: { color: 'black' } });
  });
});
