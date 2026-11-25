import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildV25SavePayload, type V25EditorState, type V25LineRow, type V25SlotRow } from '@/lib/domain/standard-estimate-v25-view';
import { v25HasRowOrder, v25RowOrderRefs, v25WithRowOrder } from '@/lib/domain/standard-estimate-v25-row-persistence';
import { v25MoveManualLineWithinWorkGroup } from '@/components/admin/standard-estimate-v25-work-groups';
import { v25SavePayloadSchema } from '@/lib/domain/standard-estimate-v25-payload-schema';
import { v25SourceSlotGroupLabel } from '@/lib/domain/standard-quote-v25-source';

// 2026-11-16 の先方の依頼：商品行と手入力明細の混在の並び順の保存と、商品行の工事項目の保存（DB・保存・読み込みの部分）
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

const OPTION = '11111111-1111-4111-8111-111111111111';
const schemaPayload = (slotExtra: Record<string, unknown> = {}, lineExtra: Record<string, unknown> = {}) => ({
  rates: { sales_fee_rate: '1', markup_rate: '1.5', expense_rate: '0.15' },
  adjustment: 0,
  adjustment_reason: null,
  slots: [{
    baseline_key: null, option_id: OPTION, variant_choice_ids: [], quantity: '1', price_mode: 'auto', manual_unit_price: null,
    slot_code: null, slot_label: null, selectable_option_ids: [], ...slotExtra,
  }],
  lines: [{
    line_key: null, section_code: 'interior_exterior', group_label: '2. 屋根工事', name: '板金の役物', quantity: '1', unit: '式',
    price_mode: 'manual', unit_price: 1000, remark: null, review_required: false, ...lineExtra,
  }],
});

describe('並び順（DB の display_order）の保存と読み込み', () => {
  it('並び順の無い下書き（今までの画面）は並び順を送らない（今までどおり商品→手入力の順で保存）', () => {
    const payload = buildV25SavePayload(state([slot('s1', 'p1'), slot('s2', 'p2')], [line('l1'), line('l2')]));
    expect(payload.slots.map((row) => row.row_order)).toEqual([null, null]);
    expect(payload.lines.map((row) => row.row_order)).toEqual([null, null]);
    expect(v25HasRowOrder(state([slot('s1', 'p1')], []))).toBe(false);
    expect(v25HasRowOrder(state([], []))).toBe(false);
  });

  it('全部の行に並び順があれば、その順で 1 から詰め直して送る', () => {
    const saved = state(
      [slot('s1', 'p1', { row_order: 20 }), slot('s2', 'p2', { row_order: 5 })],
      [line('l1', { row_order: 10 })]
    );
    expect(v25HasRowOrder(saved)).toBe(true);
    const payload = buildV25SavePayload(saved);
    expect(payload.slots.map((row) => row.row_order)).toEqual([3, 1]);
    expect(payload.lines.map((row) => row.row_order)).toEqual([2]);
  });

  it('読み込んだ並び順のある下書きに行を足したら、古い番号は送らない（追加した商品が手入力の後ろに回らないように）', () => {
    const added = state(
      [slot('s1', 'p1', { row_order: 1 }), slot('s-new', 'p9')],
      [line('l1', { row_order: 2 }), line('l2', { row_order: 3 })]
    );
    expect(v25HasRowOrder(added)).toBe(false);
    const payload = buildV25SavePayload(added);
    expect([...payload.slots, ...payload.lines].map((row) => row.row_order)).toEqual([null, null, null, null]);
  });

  it('保存した順の参照：並び順のある行をその順に、無い行をその後ろに商品→手入力の配列の順で', () => {
    const saved = state(
      [slot('s1', 'p1', { row_order: 20 }), slot('s2', 'p2', { row_order: 5 }), slot('s3', 'p3')],
      [line('l1', { row_order: 10 }), line('l2')]
    );
    expect(v25RowOrderRefs(saved)).toEqual([
      { kind: 'slot', key: 's2' }, { kind: 'line', key: 'l1' }, { kind: 'slot', key: 's1' }, { kind: 'slot', key: 's3' }, { kind: 'line', key: 'l2' },
    ]);
    // 画面が全行に付け直すと送る
    const payload = buildV25SavePayload(v25WithRowOrder(saved, v25RowOrderRefs(saved)));
    expect(payload.slots.map((row) => row.row_order)).toEqual([3, 1, 4]);
    expect(payload.lines.map((row) => row.row_order)).toEqual([2, 5]);
  });

  it('同じ工事項目の中の上下の移動（#674）は、保存した並び順も入れ替える', () => {
    const lines = [line('l1', { group_label: '雑工事', row_order: 2 }), line('l2', { group_label: '雑工事', row_order: 3 })];
    const moved = v25MoveManualLineWithinWorkGroup(lines, 'l1', 1);
    expect(moved.map((row) => [row.key, row.row_order])).toEqual([['l2', 2], ['l1', 3]]);
    // 並び順の無い行は今までどおり入れ替えるだけ（row_order の項目を足さない）
    const plain = v25MoveManualLineWithinWorkGroup([line('a', { group_label: '雑工事' }), line('b', { group_label: '雑工事' })], 'a', 1);
    expect(plain.map((row) => row.key)).toEqual(['b', 'a']);
    expect(plain.every((row) => !('row_order' in row))).toBe(true);
  });

  it('画面の並び（{kind, key} の配列）のとおりに付け直す。並べ替えだけでは数量・単価などは変わらない', () => {
    const before = state([slot('s1', 'p1', { quantity: '2' }), slot('s2', 'p2')], [line('l1', { unit_price: '3000' })]);
    const after = v25WithRowOrder(before, [{ kind: 'line', key: 'l1' }, { kind: 'slot', key: 's2' }, { kind: 'slot', key: 's1' }]);
    expect(after.lines[0].row_order).toBe(1);
    expect(after.slots.map((row) => row.row_order)).toEqual([3, 2]);
    const strip = (payload: ReturnType<typeof buildV25SavePayload>) => ({
      ...payload,
      slots: payload.slots.map(({ row_order: _order, ...rest }) => rest),
      lines: payload.lines.map(({ row_order: _order, ...rest }) => rest),
    });
    expect(strip(buildV25SavePayload(after))).toEqual(strip(buildV25SavePayload(before)));
    // 配列の順（DB の sort_order の元）も変えない
    expect(after.slots.map((row) => row.key)).toEqual(['s1', 's2']);
  });

  it('同じ番号の行・もう無い行の参照があっても、重なりのない番号を全行に付ける', () => {
    const dup = state([slot('s1', 'p1', { row_order: 1 }), slot('s2', 'p2', { row_order: 1 })], [line('l1', { row_order: 1 })]);
    const payload = buildV25SavePayload(dup);
    const orders = [...payload.slots.map((row) => row.row_order), ...payload.lines.map((row) => row.row_order)];
    expect([...orders].sort()).toEqual([1, 2, 3]);
    const withStale = v25WithRowOrder(dup, [{ kind: 'slot', key: 'gone' }, { kind: 'line', key: 'l1' }]);
    expect(withStale.lines[0].row_order).toBe(1);
  });

  it('工事項目は前後の空白を除いて送り、空は null（未設定）', () => {
    const payload = buildV25SavePayload(state(
      [slot('s1', 'p1', { work_item: ' 2. 屋根工事 ' }), slot('s2', 'p2', { work_item: '  ' }), slot('s3', 'p3')],
      []
    ));
    expect(payload.slots.map((row) => row.work_item)).toEqual(['2. 屋根工事', null, null]);
  });

  it('読み込み：DB の display_order・work_item を初期状態の row_order・work_item に写す（列の無い DB は今の列だけ読む）', () => {
    const loader = read('lib/data/standard-estimate-v25.ts');
    expect(loader).toContain("${withRowOrder ? ' display_order, work_item,' : ''}");
    expect(loader).toContain("${withRowOrder ? ', display_order' : ''}");
    expect(loader).toContain('row_order: slot.display_order ?? null,');
    expect(loader).toContain("work_item: slot.work_item ?? '',");
    expect(loader).toContain('row_order: line.display_order ?? null,');
    expect(loader).toContain('if (slotsResult.error && missingColumn(slotsResult.error)) slotsResult = await readSlots(true, false);');
    expect(loader).toContain('if (slotsResult.error && missingColumn(slotsResult.error)) slotsResult = await readSlots(false, false);');
    // 列が無いことを「表が無い」と取り違えて明細を空で読むと、次の保存で明細が消える。列が無いときは読み直し、それでも駄目なら止める
    expect(loader).toContain('if (linesResult.error && (missingColumn(linesResult.error) || !isMissingRelation(linesResult.error))) {');
  });
});

describe('保存の入力の確かめ（Server Action の zod）', () => {
  it('並び順・工事項目を捨てずに通す（工事項目は前後の空白を除く）', () => {
    const parsed = v25SavePayloadSchema.parse(schemaPayload({ row_order: 2, work_item: ' 2. 屋根工事 ' }, { row_order: 1 }));
    expect(parsed.slots[0].row_order).toBe(2);
    expect(parsed.slots[0].work_item).toBe('2. 屋根工事');
    expect(parsed.lines[0].row_order).toBe(1);
  });

  it('並び順・工事項目の無い今までの形も通す', () => {
    const parsed = v25SavePayloadSchema.parse(schemaPayload());
    expect(parsed.slots[0].row_order).toBeUndefined();
    expect(parsed.slots[0].work_item).toBeUndefined();
    expect(parsed.lines[0].row_order).toBeUndefined();
  });

  it('並び順は 1〜100000 の整数、工事項目は 120 文字まで（DB と同じ決まり）', () => {
    for (const bad of [0, 100001, 1.5, '2']) {
      expect(v25SavePayloadSchema.safeParse(schemaPayload({ row_order: bad })).success).toBe(false);
      expect(v25SavePayloadSchema.safeParse(schemaPayload({}, { row_order: bad })).success).toBe(false);
    }
    expect(v25SavePayloadSchema.safeParse(schemaPayload({ work_item: 'あ'.repeat(121) })).success).toBe(false);
    expect(v25SavePayloadSchema.safeParse(schemaPayload({ work_item: 5 })).success).toBe(false);
    expect(v25SavePayloadSchema.safeParse(schemaPayload({ row_order: 100000, work_item: 'あ'.repeat(120) })).success).toBe(true);
  });

  it('Server Action はこの確かめを使う', () => {
    const action = read('lib/actions/standard-estimate-v25.ts');
    expect(action).toContain("import { v25SavePayloadSchema } from '@/lib/domain/standard-estimate-v25-payload-schema';");
    expect(action).toContain('revisionSchema.extend({ payload: v25SavePayloadSchema })');
  });
});

describe('見積の下書きの明細の摘要（工事項目）', () => {
  const base = { category_name_snapshot: '屋根', slot_label: null as string | null };

  it('工事項目があれば工事項目、位置の枠は「工事項目（位置）」。無ければ今までどおりカテゴリー', () => {
    expect(v25SourceSlotGroupLabel({ ...base, work_item: '2. 屋根工事' })).toBe('2. 屋根工事');
    expect(v25SourceSlotGroupLabel({ ...base, slot_label: '北面', work_item: '3. 外壁工事' })).toBe('3. 外壁工事（北面）');
    expect(v25SourceSlotGroupLabel({ ...base, work_item: null })).toBe('屋根');
    expect(v25SourceSlotGroupLabel({ ...base, slot_label: '北面' })).toBe('屋根（北面）');
    expect(v25SourceSlotGroupLabel({ ...base, work_item: '' })).toBe('屋根');
  });

  it('下書きの画面は工事項目も読み、列の無い DB では除いて読み直す', () => {
    const page = read('app/admin/quotes/standard-drafts/[id]/page.tsx');
    expect(page).toContain("${withWorkItem ? ' work_item,' : ''}");
    expect(page).toContain('sourceRevisionId ? readV25SourceSlots(supabase, sourceRevisionId) : Promise.resolve({ data: [], error: null }),');
  });
});
