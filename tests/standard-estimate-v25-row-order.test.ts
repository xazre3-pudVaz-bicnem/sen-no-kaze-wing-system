import { describe, expect, it } from 'vitest';
import type { V25EditorState } from '@/lib/domain/standard-estimate-v25-view';
import {
  v25DefaultMixedRowOrder, v25ReconcileMixedRowOrder, v25MoveMixedRow,
  v25InsertMixedRow, v25MixedOrderEquals, v25MixedRowIdentity,
  type V25MixedRowRef,
} from '@/lib/domain/standard-estimate-v25-row-order';

const mkSlot = (key: string, option_id: string) => ({
  key, baseline_key: key, option_id, variant_choices: { size: 'medium' },
  quantity: '1', price_mode: 'auto' as const, manual_unit_price: '',
  slot_code: key, slot_label: '設置位置', selectable_option_ids: ['alternative'],
});
const mkLine = (key: string, section_code: 'interior_exterior' | 'option' | 'sitework') => ({
  key, line_key: key, section_code, group_label: '', name: '工事費',
  quantity: '1', unit: '式', price_mode: 'por' as const, unit_price: '',
  remark: '', review_required: false,
});
const sectionOf = (optionId: string) => optionId.startsWith('s') ? 'sitework' as const
  : optionId.startsWith('i') ? 'interior_exterior' as const : 'option' as const;
const initial: V25EditorState = {
  sales_fee_rate: '1.1', markup_rate: '1.5', expense_rate: '0.1', adjustment: '0',
  adjustment_reason: '',
  slots: [mkSlot('p1', 'option-a'), mkSlot('p2', 'option-b'), mkSlot('s1', 'sitework-a')],
  lines: [mkLine('l1', 'option'), mkLine('l2', 'option'), mkLine('sl1', 'sitework')],
};
const ref = (kind: V25MixedRowRef['kind'], key: string, section: V25MixedRowRef['section'] = 'option'): V25MixedRowRef =>
  ({ kind, key, section });
const keys = (order: readonly V25MixedRowRef[]) => order.map(v25MixedRowIdentity);

describe('標準見積v2.5 商品＋手入力の表示順（保存契約とは独立）', () => {
  it('既存の表示は区分ごとに商品→手入力。行データ・IDは変更しない', () => {
    const snapshot = JSON.stringify(initial);
    const rows = v25DefaultMixedRowOrder(initial, sectionOf);
    expect(keys(rows)).toEqual(['slot:p1', 'slot:p2', 'line:l1', 'line:l2', 'slot:s1', 'line:sl1']);
    expect(JSON.stringify(initial)).toBe(snapshot);
    expect(v25MixedOrderEquals(rows, v25ReconcileMixedRowOrder([], initial, sectionOf))).toBe(true);
  });

  it('商品・手入力の混在を上下移動でき、上端/下端/区分境界は動かない', () => {
    const rows = v25DefaultMixedRowOrder(initial, sectionOf);
    const up = v25MoveMixedRow(rows, ref('line', 'l1'), -1);
    expect(keys(up)).toEqual(['slot:p1', 'line:l1', 'slot:p2', 'line:l2', 'slot:s1', 'line:sl1']);
    const back = v25MoveMixedRow(up, ref('slot', 'p2'), -1);
    expect(keys(back)).toEqual(['slot:p1', 'slot:p2', 'line:l1', 'line:l2', 'slot:s1', 'line:sl1']);
    expect(keys(v25MoveMixedRow(rows, ref('slot', 'p1'), -1))).toEqual(keys(rows));
    expect(keys(v25MoveMixedRow(rows, ref('line', 'l2'), 1))).toEqual(keys(rows));
    expect(keys(v25MoveMixedRow(rows, ref('slot', 's1', 'sitework'), -1))).toEqual(keys(rows));
    expect(keys(v25MoveMixedRow(rows, ref('line', 'sl1', 'sitework'), 1))).toEqual(keys(rows));
    expect(keys(v25MoveMixedRow(rows, ref('line', 'missing'), 1))).toEqual(keys(rows));
  });

  it('商品・手入力のどちらの直下にも異なる種類を追加できる', () => {
    const rows = v25DefaultMixedRowOrder(initial, sectionOf);
    const addLine = v25InsertMixedRow(rows, ref('line', 'new'), ref('slot', 'p1'));
    expect(keys(addLine).slice(0, 4)).toEqual(['slot:p1', 'line:new', 'slot:p2', 'line:l1']);
    const addSlot = v25InsertMixedRow(addLine, ref('slot', 'new-product'), ref('line', 'new'));
    expect(keys(addSlot).slice(0, 5)).toEqual(['slot:p1', 'line:new', 'slot:new-product', 'slot:p2', 'line:l1']);
    expect(keys(v25InsertMixedRow(rows, ref('slot', 'p1'), ref('line', 'l1')))).toEqual(keys(rows));
    expect(keys(v25InsertMixedRow(rows, ref('line', 'new'), ref('slot', 's1', 'sitework')))).toEqual([...keys(rows).slice(0,4), 'line:new', ...keys(rows).slice(4)]);
  });

  it('区分見出しからの追加は区分末尾。別区分の起点が与えられても跨がない', () => {
    const rows = v25DefaultMixedRowOrder(initial, sectionOf);
    expect(keys(v25InsertMixedRow(rows, ref('line', 'new'), null))).toEqual([
      'slot:p1', 'slot:p2', 'line:l1', 'line:l2', 'line:new', 'slot:s1', 'line:sl1',
    ]);
    expect(keys(v25InsertMixedRow(rows, ref('line', 'new'), ref('slot', 's1', 'sitework')))).toEqual([
      'slot:p1', 'slot:p2', 'line:l1', 'line:l2', 'line:new', 'slot:s1', 'line:sl1',
    ]);
    expect(keys(v25InsertMixedRow([], ref('slot', 'new'), null))).toEqual(['slot:new']);
  });

  it('削除・新行・区分変更で順序を再整合し、残存行の相対順は保持する', () => {
    const moved = v25MoveMixedRow(v25DefaultMixedRowOrder(initial, sectionOf), ref('line', 'l1'), -1);
    const state = {
      ...initial, slots: [...initial.slots.filter((s) => s.key !== 'p2'), mkSlot('p3', 'option-c')],
      lines: [...initial.lines, mkLine('l3', 'option')],
    };
    expect(keys(v25ReconcileMixedRowOrder(moved, state, sectionOf))).toEqual([
      'slot:p1', 'line:l1', 'line:l2', 'slot:p3', 'line:l3', 'slot:s1', 'line:sl1',
    ]);
    const shifted = { ...state, slots: state.slots.map((s) => s.key === 'p1' ? { ...s, option_id: 'sitework-x' } : s) };
    const refs = v25ReconcileMixedRowOrder(moved, shifted, sectionOf);
    expect(refs.find((r) => r.key === 'p1')?.section).toBe('sitework');
    expect(refs.every((r, i) => i === 0 || ['interior_exterior','option','sitework'].indexOf(refs[i-1].section) <= ['interior_exterior','option','sitework'].indexOf(r.section))).toBe(true);
  });

  it('同じ文字列でもslot/lineのIDが衝突せず、入力データと保存ペイロードを汚さない', async () => {
    const same = { ...initial, lines: [...initial.lines, mkLine('p1', 'option')] };
    const rows = v25DefaultMixedRowOrder(same, sectionOf);
    expect(keys(rows)).toContain('slot:p1');
    expect(keys(rows)).toContain('line:p1');
    const { buildV25SavePayload } = await import('@/lib/domain/standard-estimate-v25-view');
    const before = JSON.stringify(buildV25SavePayload(same));
    const moved = v25MoveMixedRow(rows, ref('line', 'p1'), -1);
    expect(keys(moved)).not.toEqual(keys(rows));
    expect(JSON.stringify(buildV25SavePayload(same))).toBe(before);
    expect(JSON.stringify(buildV25SavePayload(same))).not.toContain('mixed_order');
  });
});
