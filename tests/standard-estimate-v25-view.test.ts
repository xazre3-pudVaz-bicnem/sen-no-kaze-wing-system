import { describe, expect, it } from 'vitest';
import {
  buildV25SavePayload,
  slotCostStatus,
  v25PublishBlockers,
  validateV25EditorState,
  type V25EditorState,
  type V25Preview,
} from '@/lib/domain/standard-estimate-v25-view';

const base = (): V25EditorState => ({
  sales_fee_rate: '1.07',
  markup_rate: '1.5',
  expense_rate: '0.15',
  adjustment: '0',
  adjustment_reason: '',
  slots: [
    { key: 's1', baseline_key: 'b1', option_id: 'p1', variant_choices: { g1: 'c2' }, quantity: '2', price_mode: 'auto', manual_unit_price: '' },
    { key: 's2', baseline_key: null, option_id: 'p3', variant_choices: {}, quantity: '1', price_mode: 'manual', manual_unit_price: '30000' },
    { key: 's3', baseline_key: null, option_id: 'p4', variant_choices: {}, quantity: '1', price_mode: 'por', manual_unit_price: '999' },
  ],
  lines: [
    { key: 'l1', line_key: 'k1', section_code: 'sitework', group_label: '', name: '設置工事', quantity: '1', unit: '式', price_mode: 'manual', unit_price: '50000', remark: '', review_required: true },
    { key: 'l2', line_key: null, section_code: 'sitework', group_label: '', name: '外構工事', quantity: '1', unit: '式', price_mode: 'por', unit_price: '123', remark: '', review_required: false },
  ],
});

describe('標準見積 v2.5 の編集画面：入力の確認（DB と同じ決まり）', () => {
  it('正しい入力は通す', () => {
    expect(validateV25EditorState(base())).toBeNull();
  });

  it('率は小数 4 桁まで・DB と同じ範囲', () => {
    expect(validateV25EditorState({ ...base(), sales_fee_rate: '1.6' })).toMatch(/販売費率は 100〜150%/);
    expect(validateV25EditorState({ ...base(), markup_rate: '1.50001' })).toMatch(/掛率は小数 4 桁まで/);
    expect(validateV25EditorState({ ...base(), expense_rate: '0.31' })).toMatch(/経費率は 0〜30%/);
  });

  it('調整額は整数円で、0 以外なら理由が必要', () => {
    expect(validateV25EditorState({ ...base(), adjustment: '-1000' })).toMatch(/理由を入力/);
    expect(validateV25EditorState({ ...base(), adjustment: '-1000', adjustment_reason: '端数調整' })).toBeNull();
    expect(validateV25EditorState({ ...base(), adjustment: '1.5' })).toMatch(/整数円/);
  });

  it('商品は重複させず、manual は売価が必要。明細の manual も売価が必要', () => {
    const state = base();
    expect(validateV25EditorState({ ...state, slots: [state.slots[0], { ...state.slots[0], key: 'x' }] })).toMatch(/同じ商品が重複/);
    expect(validateV25EditorState({ ...state, slots: [{ ...state.slots[1], manual_unit_price: '' }] })).toMatch(/売価単価/);
    expect(validateV25EditorState({ ...state, lines: [{ ...state.lines[0], unit_price: '-1' }] })).toMatch(/売価単価/);
    expect(validateV25EditorState({ ...state, slots: [{ ...state.slots[0], option_id: '' }] })).toMatch(/商品を選んで/);
    expect(validateV25EditorState({ ...state, lines: [{ ...state.lines[0], name: ' ' }] })).toMatch(/品名/);
    expect(validateV25EditorState({ ...state, slots: [{ ...state.slots[0], quantity: '0' }] })).toMatch(/数量/);
  });
});

describe('標準見積 v2.5 の編集画面：保存内容の組み立て', () => {
  it('選択肢・価格の決め方・売価を RPC の形にし、別途見積・auto には売価を送らない', () => {
    const payload = buildV25SavePayload(base());
    expect(payload.rates).toEqual({ sales_fee_rate: '1.07', markup_rate: '1.5', expense_rate: '0.15' });
    expect(payload.adjustment).toBe(0);
    expect(payload.adjustment_reason).toBeNull();
    expect(payload.slots).toEqual([
      { baseline_key: 'b1', option_id: 'p1', variant_choice_ids: ['c2'], quantity: '2', price_mode: 'auto', manual_unit_price: null },
      { baseline_key: null, option_id: 'p3', variant_choice_ids: [], quantity: '1', price_mode: 'manual', manual_unit_price: 30000 },
      { baseline_key: null, option_id: 'p4', variant_choice_ids: [], quantity: '1', price_mode: 'por', manual_unit_price: null },
    ]);
    expect(payload.lines[0]).toMatchObject({ line_key: 'k1', price_mode: 'manual', unit_price: 50000, review_required: true, group_label: null });
    expect(payload.lines[1]).toMatchObject({ line_key: null, price_mode: 'por', unit_price: null, review_required: false });
  });
});

describe('標準見積 v2.5 の編集画面：公開できない理由', () => {
  const preview = (overrides: Partial<V25Preview> = {}): V25Preview => ({
    rules_current: true,
    publishable: true,
    calc_error: null,
    incomplete: [],
    slots: [
      { baseline_key: 'b1', option_id: 'p1', name: '商品1', price_mode: 'auto', cost_status: 'current', variants: [{ variant_choice_id: 'c2', status: 'current' }] },
    ],
    ...overrides,
  });

  it('保存済み・最新の原価なら理由はない', () => {
    expect(v25PublishBlockers(preview(), false)).toEqual([]);
  });

  it('未保存の変更・古い原価・原価未設定・ルールの更新を、それぞれ理由として示す', () => {
    const blockers = v25PublishBlockers(
      preview({
        rules_current: false,
        incomplete: [{ option_id: 'p3', name: '商品3', reason: 'missing_standard_cost' }],
        slots: [{ baseline_key: 'b1', option_id: 'p1', name: '商品1', price_mode: 'auto', cost_status: 'current', variants: [{ variant_choice_id: 'c2', status: 'stale' }] }],
      }),
      true
    );
    expect(blockers.join('\n')).toMatch(/保存していない変更/);
    expect(blockers.join('\n')).toMatch(/計算ルール・税ルールが更新/);
    expect(blockers.join('\n')).toMatch(/「商品3」の商品の標準原価が未設定/);
    expect(blockers.join('\n')).toMatch(/「商品1」の原価が更新されています/);
  });

  it('選択枠の状態は、選択肢を含めてもっとも悪いものを示す（auto 以外は示さない）', () => {
    expect(slotCostStatus({ baseline_key: 'b', option_id: 'p', name: 'x', price_mode: 'auto', cost_status: 'current', variants: [{ variant_choice_id: 'c', status: 'missing' }] })).toBe('missing');
    expect(slotCostStatus({ baseline_key: 'b', option_id: 'p', name: 'x', price_mode: 'auto', cost_status: 'stale', variants: [] })).toBe('stale');
    expect(slotCostStatus({ baseline_key: 'b', option_id: 'p', name: 'x', price_mode: 'manual', cost_status: null, variants: [] })).toBeNull();
  });
});
