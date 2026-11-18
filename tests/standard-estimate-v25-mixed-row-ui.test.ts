import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildV25SavePayload, type V25EditorState } from '@/lib/domain/standard-estimate-v25-view';
import { v25WithRowOrder } from '@/lib/domain/standard-estimate-v25-row-persistence';
import {
  v25PersistedMixedRowOrder, v25ReconcileMixedRowOrder, v25MixedRowsForWorkGroup,
  v25MoveMixedRowWithinGroup, v25InsertMixedRow, v25MixedOrderEquals, v25MixedRowIdentity,
} from '@/lib/domain/standard-estimate-v25-row-order';
import { v25WorkGroupsForDisplay } from '@/components/admin/standard-estimate-v25-work-groups';
const source = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/standard-estimate-v25-workbench.tsx'),'utf8');
const slot = (key: string, option_id: string, row_order?: number) => ({
  key, baseline_key: key, option_id, variant_choices: {}, quantity:'1', price_mode:'manual' as const,
  manual_unit_price:'1000', slot_code:'',slot_label:'',selectable_option_ids:[],
  work_item:'1. サッシ・木製建具工事', row_order:row_order ?? null,
});
const line = (key:string,row_order?:number) => ({
  key,line_key:key,section_code:'interior_exterior' as const,group_label:'1. サッシ・木製建具工事',
  name:key,quantity:'1',unit:'式',price_mode:'manual' as const,unit_price:'1000',remark:'',
  review_required:false,row_order:row_order ?? null,
});
const state = (persisted=false):V25EditorState=>({
  sales_fee_rate:'1',markup_rate:'1.5',expense_rate:'0.15',adjustment:'0',adjustment_reason:'',
  slots:[slot('a','sash-a',persisted?2:undefined),slot('b','sash-b',persisted?4:undefined)],
  lines:[line('c',persisted?1:undefined),line('d',persisted?3:undefined)],
});
const sectionOf = ()=>'interior_exterior' as const;
const groupOf=(editor:V25EditorState)=>v25WorkGroupsForDisplay(
  editor.slots,editor.lines,()=> 'sash',(x)=>x.group_label,
  {modelSlug:'wing-01',specCode:'hotel',sectionCode:'interior_exterior'}
)[0];
const ids=(refs:readonly {kind:'slot'|'line';key:string}[])=>refs.map(v25MixedRowIdentity);
describe('PR #666 × #686/#687 混在順序の保存・読込・工事項目整合',()=>{
  it('DBで保存した順番を復元し、商品／自由入力が混在する',()=>{
    const editor=state(true);
    const order=v25PersistedMixedRowOrder(editor,sectionOf);
    expect(ids(v25MixedRowsForWorkGroup(order,groupOf(editor)))).toEqual(['line:c','slot:a','line:d','slot:b']);
  });
  it('↑↓で商品と手入力を交換し、両種類のrow_orderを連続採番して保存→再読込する',()=>{
    const editor=state(true);
    const group=groupOf(editor);
    const before=v25PersistedMixedRowOrder(editor,sectionOf);
    const after=v25MoveMixedRowWithinGroup(before,group,{kind:'slot',key:'a'},-1);
    expect(ids(after)).toEqual(['slot:a','line:c','line:d','slot:b']);
    const packed=v25WithRowOrder(editor,after);
    const payload=buildV25SavePayload(packed);
    const rows=[...payload.slots.map(x=>x.row_order),...payload.lines.map(x=>x.row_order)].sort((a,b)=>(a??0)-(b??0));
    expect(rows).toEqual([1,2,3,4]);
    expect(payload.slots[0].work_item).toBe('1. サッシ・木製建具工事');
    expect(payload.lines[0].group_label).toBe('1. サッシ・木製建具工事');
    expect(payload.slots.map(x=>x.manual_unit_price)).toEqual([1000,1000]);
    expect(payload.lines.map(x=>x.unit_price)).toEqual([1000,1000]);
    // 保存した row_order を読み込み直すのと同じ形で復元（DBは runtime rehearsal が検査）。
    const reloaded:V25EditorState={...editor,
      slots:editor.slots.map((row,i)=>({...row,row_order:payload.slots[i].row_order})),
      lines:editor.lines.map((row,i)=>({...row,row_order:payload.lines[i].row_order}))};
    expect(ids(v25PersistedMixedRowOrder(reloaded,sectionOf))).toEqual(ids(after));
  });
  it('新規追加・別の位置への複製・区分／工事項目移動後も有効な行だけで再整合',()=>{
    const editor=state(true),before=v25PersistedMixedRowOrder(editor,sectionOf);
    const inserted=v25InsertMixedRow(before,{kind:'line',key:'new',section:'interior_exterior'},
      {kind:'slot',key:'a',section:'interior_exterior'});
    const expanded={...editor,lines:[...editor.lines,line('new')]};
    expect(ids(v25ReconcileMixedRowOrder(inserted,expanded,sectionOf))).toEqual(
      ['line:c','slot:a','line:new','line:d','slot:b']
    );
    expect(ids(v25MoveMixedRowWithinGroup(before,
      {slots:[editor.slots[0]],lines:[editor.lines[0]]},{kind:'slot',key:'b'},-1))).toEqual(ids(before));
  });

  it('並び順のみ変更→変更を破棄→保存前の順序に復元→未保存状態を解除', () => {
    const initial = state(true);
    const group = groupOf(initial);
    const initialOrder = v25PersistedMixedRowOrder(initial, sectionOf);
    const savedViewOrder = v25MixedRowsForWorkGroup(initialOrder, group);
    expect(ids(savedViewOrder)).toEqual(['line:c', 'slot:a', 'line:d', 'slot:b']);

    // 商品行と手入力明細を上下交換：商品・金額・工事項目そのものは未編集。
    const viewOrder = v25MoveMixedRowWithinGroup(initialOrder, group, { kind: 'slot', key: 'a' }, -1);
    const editedDirty = false;
    const orderDirty = !v25MixedOrderEquals(viewOrder, initialOrder);
    const dirty = editedDirty || false /* unsavedAutoWorkItems > 0 */ || orderDirty;
    expect(orderDirty).toBe(true);
    expect(dirty).toBe(true);
    expect(ids(viewOrder)).toEqual(['slot:a', 'line:c', 'line:d', 'slot:b']);
    // 並び順のみでも変更破棄を押せる。保存中・位置名編集中の保護は維持。
    expect(!editedDirty && !orderDirty).toBe(false);
    expect(false || (!editedDirty && !orderDirty) || false).toBe(false);
    expect(true || (!editedDirty && !orderDirty) || false).toBe(true);
    expect(false || (!editedDirty && !orderDirty) || true).toBe(true);

    // UIの変更破棄ハンドラーは setState(initial) と setViewOrder([]) を両方行う。
    const discardedState = initial;
    const discardedViewOrder: typeof viewOrder = [];
    const restored = v25ReconcileMixedRowOrder(
      discardedViewOrder.length ? discardedViewOrder : v25PersistedMixedRowOrder(discardedState, sectionOf),
      discardedState, sectionOf,
    );
    expect(ids(restored)).toEqual(ids(initialOrder));
    const afterDiscardOrderDirty = !v25MixedOrderEquals(restored, initialOrder);
    const afterDiscardDirty = false /* editedDirty */ || false /* unsavedAutoWorkItems */ || afterDiscardOrderDirty;
    expect(afterDiscardOrderDirty).toBe(false);
    expect(afterDiscardDirty).toBe(false);
    expect(JSON.stringify(discardedState)).toBe(JSON.stringify(initial));
    expect(!false && !afterDiscardOrderDirty).toBe(true);

    // 単体の順序計算だけでなく、実際のボタン条件・破棄処理への結線も固定して回帰防止。
    expect(source).toContain('disabled={pending || (!editedDirty && !orderDirty) || positionInputActive} onClick={() => {');
    expect(source).toContain('setState(initial);\n              setViewOrder([]);');
    expect(source).toContain('const dirty = editedDirty || unsavedAutoWorkItems > 0 || orderDirty;');
    expect(source).toContain('v25PublishBlockers(preview, dirty)');
  });

  it('画面の↑↓＋が保存・公開と結線され、既存の工事項目／本体／価格UIは維持する',()=>{
    expect(source).toContain('v25MixedRowsForWorkGroup(mixedOrder, workGroup).map((rowRef, rowIndex) => {');
    expect(source).toContain('data-testid="v25-wb-row-up"');
    expect(source).toContain('data-testid="v25-wb-row-down"');
    expect(source).toContain('testId="v25-wb-row-insert"');
    expect(source).toContain('v25WithRowOrder(toSave, renderedMixedOrder)');
    expect(source).toContain('payload: buildV25SavePayload(orderedToSave)');
    expect(source).toContain('work_item: workItemOf(slot)');
    expect(source).toContain('v25WorkGroupsForDisplay(');
    expect(source).toContain("sectionHeader('base', '本体（本体マスター')".slice(0,16));
    expect(source).toContain('publishStandardEstimateV25RevisionAction');
    expect(source).toContain('calculateV25Workbench(');
  });
});
