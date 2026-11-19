import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { V25EditorState } from '@/lib/domain/standard-estimate-v25-view';
import { buildV25SavePayload } from '@/lib/domain/standard-estimate-v25-view';
import { v25WithRowOrder } from '@/lib/domain/standard-estimate-v25-row-persistence';
import {
  v25MixedRowsForWorkGroup, v25MixedOrderEquals, v25MixedRowIdentity,
  v25PersistedMixedRowOrder,
} from '@/lib/domain/standard-estimate-v25-row-order';
import {
  v25ArrowRowTarget, v25PlanMixedRowMove, v25MoveDestinationLabel,
} from '@/components/admin/standard-estimate-v25-row-move';
import { v25WorkGroupsForDisplay } from '@/components/admin/standard-estimate-v25-work-groups';

const labels = {
  sash: '1. サッシ・木製建具工事',
  roof: '2. 屋根工事',
  wall: '3. 外壁工事',
};
const slot = (key: string, optionId: string, label: string, row_order: number) => ({
  key, baseline_key: key, option_id: optionId, variant_choices: {}, quantity: '4',
  price_mode: 'manual' as const, manual_unit_price: '19900', slot_code: 'north', slot_label: '北面',
  selectable_option_ids: ['alternative'], work_item: label, row_order,
});
const line = (key: string, label: string, row_order: number) => ({
  key, line_key: key, section_code: 'interior_exterior' as const, group_label: label,
  name: key, quantity: '2', unit: '式', price_mode: 'manual' as const, unit_price: '8000',
  remark: '据付', review_required: false, row_order,
});
const initial = (): V25EditorState => ({
  sales_fee_rate: '1.07', expense_rate: '0.15', markup_rate: '1.5',
  adjustment: '0', adjustment_reason: '',
  slots: [
    slot('sash', 'p-sash', labels.sash, 1),
    slot('roof', 'p-roof', labels.roof, 3),
    slot('wall', 'p-wall', labels.wall, 5),
  ],
  lines: [line('sashLine', labels.sash, 2), line('roofLine', labels.roof, 4)],
});
const categories: Record<string, string> = { 'p-sash': 'sash', 'p-roof': 'roof', 'p-wall': 'exterior-wall' };
const sectionOf = (id: string) => categories[id] ? 'interior_exterior' as const : undefined;
const context = { modelSlug: 'wing-01', specCode: 'hotel', sectionCode: 'interior_exterior' as const, sectionOf };
const groupsFor = (s: V25EditorState) => v25WorkGroupsForDisplay(
  s.slots, s.lines, (id) => categories[id], (row) => row.group_label, context,
  (row) => row.work_item || '',
);
const rows = (s: V25EditorState) => v25PersistedMixedRowOrder(s, sectionOf);
const ids = (order: readonly { kind: 'slot'|'line'; key: string }[]) => order.map(v25MixedRowIdentity);
const source = (kind: 'slot'|'line', key: string) =>
  ({ kind, key, section: 'interior_exterior' as const });
const rendered = (s: V25EditorState, order: ReturnType<typeof rows>) =>
  groupsFor(s).flatMap((g) => v25MixedRowsForWorkGroup(order, g));
const moveArrow = (s: V25EditorState, order: ReturnType<typeof rows>, kind: 'slot'|'line', key: string, direction: -1|1) => {
  const ref = source(kind,key);
  const groups=groupsFor(s);
  const target=v25ArrowRowTarget(order, groups, ref, direction);
  return target ? v25PlanMixedRowMove(s, order, groups, ref, target.row, target.side, context) : null;
};

describe('明細行 ↑↓／ドラッグの工事項目移動（DB・金額計算を変更しない）', () => {
  it('同じ工事項目内では1行ずつ混在移動し、工事項目と数量は変わらない', () => {
    const s = initial(), order = rows(s);
    const moved=moveArrow(s,order,'slot','sash',1);
    expect(moved).not.toBeNull();
    expect(ids(rendered(moved!.state,moved!.order))).toEqual([
      'line:sashLine', 'slot:sash', 'slot:roof', 'line:roofLine', 'slot:wall',
    ]);
    expect(moved!.state).toBe(s);
    expect(s.slots[0].quantity).toBe('4');
  });

  it('最後の手入力行↓は隣の屋根グループ先頭へ入り、group_labelを正しく更新', () => {
    const s=initial(), order=rows(s);
    const moved=moveArrow(s,order,'line','sashLine',1);
    expect(moved).not.toBeNull();
    expect(moved!.state.lines[0].group_label).toBe(labels.roof);
    expect(ids(rendered(moved!.state,moved!.order))).toEqual([
      'slot:sash', 'line:sashLine', 'slot:roof', 'line:roofLine', 'slot:wall',
    ]);
    expect(groupsFor(moved!.state).find(g=>g.key==='work:roof')?.lines.map(x=>x.key)).toEqual(['sashLine','roofLine']);
    expect(JSON.stringify(s.lines[0])).toContain(labels.sash); // 元のstateは変更しない
    expect(moved!.state.lines[0].unit_price).toBe('8000');
  });

  it('最初の商品行↑は前の工事項目末尾へ入り、work_itemを更新（カテゴリーはそのまま）', () => {
    const s=initial(), order=rows(s);
    const moved=moveArrow(s,order,'slot','roof',-1);
    expect(moved).not.toBeNull();
    expect(moved!.state.slots[1].work_item).toBe(labels.sash);
    expect(moved!.state.slots[1].option_id).toBe('p-roof');
    expect(ids(rendered(moved!.state,moved!.order)).slice(0,3)).toEqual([
      'slot:sash','line:sashLine','slot:roof',
    ]);
    expect(moved!.state.slots[1].variant_choices).toEqual(s.slots[1].variant_choices);
    expect(moved!.state.slots[1].slot_label).toBe('北面');
  });

  it('ドラッグは行の前後へ挿入。同じ項目・別項目に対応し、保存と再読込で順番が残る', () => {
    const s=initial(), order=rows(s), groups=groupsFor(s);
    const dragSame=v25PlanMixedRowMove(
      s, order, groups, source('line','sashLine'), source('slot','sash'), 'before', context,
    );
    expect(ids(rendered(dragSame!.state,dragSame!.order)).slice(0,2)).toEqual(['line:sashLine','slot:sash']);
    const dragAcross=v25PlanMixedRowMove(
      dragSame!.state,dragSame!.order,groupsFor(dragSame!.state),
      source('slot','wall'),source('line','roofLine'),'before',context,
    );
    expect(dragAcross).not.toBeNull();
    expect(dragAcross!.state.slots[2].work_item).toBe(labels.roof);
    const display=rendered(dragAcross!.state,dragAcross!.order);
    expect(ids(display)).toEqual(['line:sashLine','slot:sash','slot:roof','slot:wall','line:roofLine']);
    const saved=buildV25SavePayload(v25WithRowOrder(dragAcross!.state,display));
    const reloaded: V25EditorState = {
      ...dragAcross!.state,
      slots:dragAcross!.state.slots.map((x,i)=>({...x,row_order:saved.slots[i].row_order})),
      lines:dragAcross!.state.lines.map((x,i)=>({...x,row_order:saved.lines[i].row_order})),
    };
    expect(ids(rendered(reloaded,rows(reloaded)))).toEqual(ids(display));
    expect(saved.slots.map(x=>x.quantity)).toEqual(['4','4','4']);
    expect(saved.lines.map(x=>x.unit_price)).toEqual([8000,8000]);
    expect(saved.slots.map(x=>x.work_item)).toEqual([labels.sash,labels.roof,labels.roof]);
    expect([...saved.slots,...saved.lines].map(x=>x.row_order).sort((a,b)=>(a??0)-(b??0))).toEqual([1,2,3,4,5]);
  });

  it('大区分越え、存在しない行、自己移動、未知・未分類の移動先は拒否して無変更', () => {
    const s=initial(), order=rows(s), groups=groupsFor(s);
    expect(v25ArrowRowTarget(order,groups,source('slot','sash'),-1)).toBeNull();
    expect(v25ArrowRowTarget(order,groups,source('slot','wall'),1)).toBeNull();
    expect(v25PlanMixedRowMove(s,order,groups,source('slot','sash'),source('slot','sash'),'after',context)).toBeNull();
    expect(v25PlanMixedRowMove(s,order,groups,source('slot','missing'),source('slot','roof'),'before',context)).toBeNull();
    expect(v25PlanMixedRowMove(s,order,groups,source('slot','sash'),{...source('slot','roof'),section:'option'},'before',context)).toBeNull();
    expect(v25MoveDestinationLabel({key:'products:unclassified',label:'工事項目未分類の商品',slots:[],lines:[]},context)).toBeNull();
    expect(v25MoveDestinationLabel({key:'manual:empty',label:'工事項目未設定（手入力）',slots:[],lines:[]},context)).toBeNull();
    expect(v25MoveDestinationLabel({key:'manual:abc',label:'不明なラベル',slots:[],lines:[]},context)).toBeNull();
    expect(v25MoveDestinationLabel({key:'manual:'+'長'.repeat(121),label:'長'.repeat(121),slots:[],lines:[]},context)).toBeNull();
  });

  it('未分類から既知工事項目への移動だけ許し、未分類・未設定へは自動変更しない',()=>{
    const s=initial();
    s.lines.push(line('unclassified','',6));
    const groups=groupsFor(s), order=rows(s);
    const moved=v25PlanMixedRowMove(s,order,groups,source('line','unclassified'),source('slot','roof'),'before',context);
    expect(moved?.state.lines.find(x=>x.key==='unclassified')?.group_label).toBe(labels.roof);
    expect(v25PlanMixedRowMove(s,order,groups,source('slot','roof'),source('line','unclassified'),'before',context)).toBeNull();
  });

  it('移動後の未保存判定、変更破棄で工事項目・順序を両方復元する',()=>{
    const s=initial(),baseline=rendered(s,rows(s));
    const next=moveArrow(s,rows(s),'line','sashLine',1)!;
    expect(JSON.stringify(next.state)).not.toBe(JSON.stringify(s));
    // グループ越えの移動では、raw順序が同じでも工事項目の違いが未保存となる。
    const dirty=JSON.stringify(next.state)!==JSON.stringify(s) ||
      !v25MixedOrderEquals(rendered(next.state,next.order),baseline);
    expect(dirty).toBe(true);
    const discardedState=s;
    const discardedOrder=rows(s); // UIは setState(initial) + setViewOrder([]) で保存済み順へ復帰
    expect(ids(rendered(discardedState,discardedOrder))).toEqual(ids(baseline));
    expect(discardedState.lines[0].group_label).toBe(labels.sash);
  });

  it('画面の操作は専用ハンドルからのみ。旧▲▼を撤去し確認付き削除は…の内部',()=>{
    const ui=fs.readFileSync(path.resolve(process.cwd(),'components/admin/standard-estimate-v25-workbench.tsx'),'utf8');
    const grip=fs.readFileSync(path.resolve(process.cwd(),'components/admin/v25-row-drag-handle.tsx'),'utf8');
    expect(ui).toContain('<V25RowDragHandle');
    expect(ui).toContain('v25PlanMixedRowMove(');
    expect(ui).toContain('v25ArrowRowTarget(');
    expect(ui).toContain('data-testid="v25-wb-drop-indicator"');
    expect(ui).toContain('data-v25-dnd-row={v25MixedRowIdentity(rowRef)}');
    expect(ui).toContain('<V25RowDeleteButton inMenu');
    expect(ui).not.toContain('v25-wb-manual-move-up');
    expect(ui).not.toContain('v25-wb-manual-move-down');
    expect(grip).toContain('setPointerCapture(event.pointerId)');
    expect(grip).toContain('touch-none');
    expect(grip).toContain('document.elementFromPoint(');
    expect(grip).toContain('onPointerCancel={clear}');
    expect(grip).toContain('window.requestAnimationFrame(scrollStep)');
    expect(grip).toContain('window.cancelAnimationFrame(scrollFrame.current)');
    expect(grip).toContain('window.scrollBy({ top: delta, behavior:');
    expect(grip).toContain('document.elementFromPoint(x, y)');
    expect(grip).toContain('const EDGE_PX = 72;');
    expect(grip).toContain('if (distance < 8) return;');
    expect(grip).not.toContain('draggable=');
    expect(ui).toContain('setState(initial);\n              setViewOrder([]);');
    expect(ui).toContain('const dirty = editedDirty || unsavedAutoWorkItems > 0 || orderDirty;');
  });
});
