import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildV25SavePayload, type V25EditorState, type V25LineRow, type V25SlotRow } from '@/lib/domain/standard-estimate-v25-view';
import {
  V25_DISPLAY_WORK_ITEMS,
  v25MoveManualLineWithinWorkGroup,
  v25WorkGroupsForDisplay,
  v25WorkItemForCategory,
  v25WorkItemForManual,
  v25OptionWorkItems,
} from '@/components/admin/standard-estimate-v25-work-groups';

const slot = (key: string, option_id: string): V25SlotRow => ({
  key, baseline_key: null, option_id, variant_choices: {}, quantity: '1',
  price_mode: 'por', manual_unit_price: '', slot_code: '', slot_label: '', selectable_option_ids: [],
});
const line = (key: string, group_label: string): V25LineRow => ({
  key, line_key: null, section_code: 'interior_exterior', group_label, name: key,
  quantity: '1', unit: '式', price_mode: 'por', unit_price: '', remark: '', review_required: false,
});
const source = readFileSync(resolve(process.cwd(), 'components/admin/standard-estimate-v25-workbench.tsx'), 'utf8');

describe('標準見積v2.5：商品カテゴリーから工事項目へ（UI表示専用）', () => {
  it('正確なカテゴリーコードだけ4工事項目に分類', () => {
    expect(V25_DISPLAY_WORK_ITEMS.map(x => x.label)).toEqual([
      '1. サッシ・木製建具工事', '2. 屋根工事', '3. 外壁工事', '4. 内装仕上げ',
    ]);
    for (const code of ['sash', 'interior-door', 'entrance-door', 'service-door']) {
      expect(v25WorkItemForCategory(code)?.key).toBe('work:sash_wood');
    }
    expect(v25WorkItemForCategory('roof')?.label).toBe('2. 屋根工事');
    expect(v25WorkItemForCategory('exterior-wall')?.label).toBe('3. 外壁工事');
    for (const code of ['floor', 'wall-ceiling']) {
      expect(v25WorkItemForCategory(code)?.key).toBe('work:interior');
    }
  });

  it('根拠のない商品カテゴリーを工事項目へ推測で振り分けない', () => {
    for (const code of ['carpentry', 'insulation', 'insulation-floor', 'insulation-wall', 'insulation-ceiling', 'ub', 'lighting', 'furniture', 'sitework', 'sash-frame', '', null, undefined]) {
      expect(v25WorkItemForCategory(code)).toBeNull();
    }
  });

  it('手入力グループは同名の工事項目だけと合流し、異なる番号や部分一致は分類しない', () => {
    expect(v25WorkItemForManual('サッシ・木製建具工事').key).toBe('work:sash_wood');
    expect(v25WorkItemForManual('1. サッシ・木製建具工事').key).toBe('work:sash_wood');
    expect(v25WorkItemForManual('2．屋根工事').key).toBe('work:roof');
    expect(v25WorkItemForManual('3、 外壁工事').key).toBe('work:exterior');
    expect(v25WorkItemForManual('4. 内装仕上げ').key).toBe('work:interior');
    expect(v25WorkItemForManual('3. 屋根工事').key).not.toBe('work:roof');
    expect(v25WorkItemForManual('屋根補修工事').key).not.toBe('work:roof');
    expect(v25WorkItemForManual('屋根工事（追加）').label).toBe('屋根工事（追加）');
    expect(v25WorkItemForManual('電気設備工事').label).toBe('電気設備工事');
    expect(v25WorkItemForManual('  ').label).toBe('工事項目未設定（手入力）');
  });

  it('中黒・番号後の空白・全角半角だけを統合し、見出しは正式名称に統一', () => {
    const variants: Record<string, string[]> = {
      '1. サッシ・木製建具工事': [
        '1. サッシ木製建具工事', '１．サッシ木製建具工事',
        '1．サッシ・木製建具工事', '1.サッシ･木製建具工事',
        '1、サッシ 木製建具工事', '１　サッシ・木製建具工事',
        'サッシ木製建具工事',
      ],
      '2. 屋根工事': ['２．屋根工事', '2. 屋根 工事', '2、屋根工事', '屋根工事'],
      '3. 外壁工事': ['３．外壁工事', '3.外壁工事', '外壁 工事'],
      '4. 内装仕上げ': ['４．内装仕上げ', '4. 内装 仕上げ', '内装仕上げ'],
    };
    for (const [official, examples] of Object.entries(variants)) {
      for (const input of examples) {
        expect(v25WorkItemForManual(input).label).toBe(official);
      }
    }
    const lineA = line('a', '1. サッシ・木製建具工事');
    const lineB = line('b', '１．サッシ木製建具工事');
    const groups = v25WorkGroupsForDisplay([slot('s', 'sash-product')], [lineA, lineB], id => id === 'sash-product' ? 'sash' : null);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('1. サッシ・木製建具工事');
    expect(groups[0].lines).toEqual([lineA, lineB]);
    expect(lineB.group_label).toBe('１．サッシ木製建具工事'); // 保存値はそのまま
  });

  it('番号違い・別工程・その他の記号を憶測で統合しない', () => {
    for (const label of [
      '2. サッシ木製建具工事', '1. 屋根工事',
      '3. 屋根工事', '4. 外壁工事',
      '1. サッシ木製建具工事（追加）', '1. サッシアルミ建具工事',
      '2. 屋根補修工事', '3. 外壁工事・補修', '4. 内装下地工事',
      '1.サッシ-木製建具工事', '5. サッシ木製建具工事',
      '特殊工事',
    ]) {
      expect(v25WorkItemForManual(label).key.startsWith('manual:')).toBe(true);
      expect(v25WorkItemForManual(label).label).toBe(label);
    }
  });

  it('自由入力だけを同一区分・同一表示グループ内で上下1行移動する', () => {
    const rows = [
      line('roof-a', '2. 屋根工事'),
      line('other-a', '電気工事'),
      line('sash-a', '1. サッシ木製建具工事'),
      line('roof-b', '２．屋根工事'),
      line('sash-b', '１．サッシ・木製建具工事'),
      { ...line('roof-other-section', '2. 屋根工事'), section_code: 'option' as const },
      line('sash-c', 'サッシ・木製建具工事'),
      line('other-b', '電気工事'),
    ];
    const original = JSON.stringify(rows);
    const moved = v25MoveManualLineWithinWorkGroup(rows, 'sash-c', -1);
    expect(moved.map(x => x.key)).toEqual([
      'roof-a', 'other-a', 'sash-a', 'roof-b', 'sash-c', 'roof-other-section', 'sash-b', 'other-b',
    ]);
    expect(moved[0]).toBe(rows[0]);
    expect(moved[1]).toBe(rows[1]);
    expect(moved[3]).toBe(rows[3]);
    expect(moved[5]).toBe(rows[5]);
    expect(moved[7]).toBe(rows[7]);
    expect(JSON.stringify(rows)).toBe(original);
    const reversed = v25MoveManualLineWithinWorkGroup(moved, 'sash-c', 1);
    expect(reversed.map(x => x.key)).toEqual(rows.map(x => x.key));
    expect(v25MoveManualLineWithinWorkGroup(rows, 'roof-a', -1)).toBe(rows);
    expect(v25MoveManualLineWithinWorkGroup(rows, 'sash-c', 1)).toBe(rows);
    expect(v25MoveManualLineWithinWorkGroup(rows, 'unknown', 1)).toBe(rows);
    expect(v25MoveManualLineWithinWorkGroup(rows, 'roof-other-section', 1)).toBe(rows);
  });

  it('行ID・数量・価格・グループ名は変更せず、保存payloadの配列順だけ変える', () => {
    const rows = [
      { ...line('one', '1. サッシ木製建具工事'), line_key: 'uuid-one', quantity: '2.5', price_mode: 'manual' as const, unit_price: '5000' },
      { ...line('other', '2. 屋根工事'), line_key: 'uuid-other', quantity: '1', price_mode: 'manual' as const, unit_price: '1000' },
      { ...line('two', '１．サッシ・木製建具工事'), line_key: 'uuid-two', quantity: '3', price_mode: 'manual' as const, unit_price: '2300' },
    ];
    const state: V25EditorState = {
      sales_fee_rate: '1.07', expense_rate: '0.15', markup_rate: '1.5',
      adjustment: '0', adjustment_reason: '', slots: [], lines: rows,
    };
    const moved = v25MoveManualLineWithinWorkGroup(state.lines, 'two', -1);
    const payload = buildV25SavePayload({ ...state, lines: moved });
    expect(payload.lines.map(x => x.line_key)).toEqual(['uuid-two', 'uuid-other', 'uuid-one']);
    expect(payload.lines[0].group_label).toBe('１．サッシ・木製建具工事');
    const originalByKey = new Map(rows.map(row => [row.line_key, row]));
    for (const row of moved) expect(row).toBe(originalByKey.get(row.line_key ?? ''));
    // RPCの既存sort_order=v_indexと同じ順に保存・再読込しても並びは復元する
    const persisted = payload.lines.map((entry, index) => ({ ...entry, sort_order: index + 1 }));
    const reloaded = [...persisted].sort((a,b) => a.sort_order - b.sort_order);
    expect(reloaded.map(x => x.line_key)).toEqual(payload.lines.map(x => x.line_key));
    expect(payload.lines.map(x => [x.line_key, x.quantity, x.unit_price]))
      .toEqual([['uuid-two', '3', 2300], ['uuid-other', '1', 1000], ['uuid-one', '2.5', 5000]]);
  });

  it('商品行と手入力行が同じ見出しに入り、未分類や既存の自由なグループを保持する', () => {
    const slots = [
      slot('s1', 'roof-product'), slot('s2', 'sash-product'), slot('s3', 'unknown-product'),
      slot('s4', 'floor-product'), slot('s5', 'wall-product'), slot('s6', 'exterior-product'),
    ];
    const lines = [
      line('l1', '4. 内装仕上げ'), line('l2', '電気設備工事'), line('l3', ''),
      line('l4', '2. 屋根工事'), line('l5', 'サッシ・木製建具工事'),
    ];
    const codes: Record<string,string> = {
      'roof-product': 'roof', 'sash-product': 'sash', 'unknown-product': 'lighting',
      'floor-product': 'floor', 'wall-product': 'wall-ceiling', 'exterior-product': 'exterior-wall',
    };
    const before = JSON.stringify({ slots, lines });
    const groups = v25WorkGroupsForDisplay(slots, lines, id => codes[id]);
    expect(groups.map(x => x.label)).toEqual([
      '1. サッシ・木製建具工事', '2. 屋根工事', '3. 外壁工事',
      '4. 内装仕上げ', '電気設備工事', '工事項目未設定（手入力）', '工事項目未分類の商品',
    ]);
    expect(groups[0].slots.map(x => x.key)).toEqual(['s2']);
    expect(groups[0].lines.map(x => x.key)).toEqual(['l5']);
    expect(groups[1].slots.map(x => x.key)).toEqual(['s1']);
    expect(groups[1].lines.map(x => x.key)).toEqual(['l4']);
    expect(groups[3].slots.map(x => x.key)).toEqual(['s4', 's5']);
    expect(groups[3].lines.map(x => x.key)).toEqual(['l1']);
    expect(groups.at(-1)?.slots.map(x => x.key)).toEqual(['s3']);
    expect(groups.flatMap(x => x.slots).length).toBe(slots.length);
    expect(groups.flatMap(x => x.lines).length).toBe(lines.length);
    expect(groups[3].slots[0]).toBe(slots[3]); // 元オブジェクトをそのまま表示する
    expect(groups[3].lines[0]).toBe(lines[0]);
    expect(JSON.stringify({ slots, lines })).toBe(before); // group_label / 並び順 / 価格は無変更
  });

  it('編集ダイアログの確定前は所属見出しが不変で、確定後のみ新所属へ移る', () => {
    const old = line('l-edit', '2. 屋根工事');
    const before = v25WorkGroupsForDisplay([], [old], () => null);
    expect(before[0].label).toBe('2. 屋根工事');
    const confirmed = { ...old, group_label: '特注工事' };
    const after = v25WorkGroupsForDisplay([], [confirmed], () => null);
    expect(after[0].label).toBe('特注工事');
    expect(old.group_label).toBe('2. 屋根工事');
    expect(confirmed.key).toBe(old.key);
    expect(confirmed.quantity).toBe(old.quantity);
    expect(confirmed.unit_price).toBe(old.unit_price);
    expect(v25WorkGroupsForDisplay([], [{ ...old, group_label: '' }], () => null)[0].label).toBe('工事項目未設定（手入力）');
  });

  it('区分内が空なら空の見出し行を表示しない', () => {
    expect(v25WorkGroupsForDisplay([], [], () => null)).toEqual([]);
  });
});

describe('標準見積v2.5：モデル仕様ごとのExcel分類（表示のみ）', () => {
  const inExterior = (modelSlug: string, specCode: string) =>
    ({ sectionCode: 'interior_exterior' as const, modelSlug, specCode });
  const inOption = (modelSlug: string, specCode: string) =>
    ({ sectionCode: 'option' as const, modelSlug, specCode });

  it('Wing・BOX・Flatは内外装の4項目を同一の番号・名称で使用', () => {
    for (const [modelSlug, specCode] of [
      ['wing-01', 'hotel'], ['wing-01', 'residence'], ['wing-01', 'office'],
      ['box', 'hotel'], ['box', 'water-kit'], ['flat', 'office'],
    ]) {
      const context = inExterior(modelSlug, specCode);
      const groups = v25WorkGroupsForDisplay(
        [slot('door','door'), slot('service','service'), slot('sash','sash'),
         slot('roof','roof'), slot('exterior','exterior'), slot('floor','floor'), slot('wall','wall')],
        [line('oldRoof','2. 屋根工事'), line('oldExterior','２．外壁工事'), line('oldInterior','３．内装仕上げ')],
        (id) => ({
          door:'entrance-door', service:'service-door', sash:'sash',
          roof:'roof', exterior:'exterior-wall', floor:'floor', wall:'wall-ceiling',
        } as Record<string,string>)[id],
        (row) => row.group_label, context,
      );
      expect(groups.map(group=>group.label)).toEqual(V25_DISPLAY_WORK_ITEMS.map(item=>item.label));
      expect(groups.map(group=>group.slots.length)).toEqual([3,1,1,2]);
      expect(groups[2].lines[0].group_label).toBe('２．外壁工事');
      expect(groups[3].lines[0].group_label).toBe('３．内装仕上げ');
    }
  });

  it('WingホテルUBで既存の未分類9商品を原本の1.設備機器と内外装に振り分ける', () => {
    const categories: Record<string,string> = {
      entrance:'entrance-door', service:'service-door',
      bath:'ub', toilet:'toilet', wash:'washbasin', boiler:'boiler',
      aircon:'aircon', shoe:'entrance-storage', bed:'bed',
    };
    const slots = Object.keys(categories).map(id=>slot(id,id));
    const old = JSON.stringify(slots);
    const outer = v25WorkGroupsForDisplay(
      slots.filter(s=>['entrance','service'].includes(s.option_id)), [line('wood','1. サッシ木製建具工事')],
      id=>categories[id], row=>row.group_label, inExterior('wing-01','hotel'),
    );
    expect(outer.map(g=>g.label)).toEqual(['1. サッシ・木製建具工事']);
    expect(outer[0].slots.map(s=>s.option_id)).toEqual(['entrance','service']);
    expect(outer[0].lines.map(l=>l.key)).toEqual(['wood']);
    const equipment = v25WorkGroupsForDisplay(
      slots.filter(s=>!['entrance','service'].includes(s.option_id)), [ {...line('fixture','１．設備機器'),section_code:'option' as const} ],
      id=>categories[id], row=>row.group_label, inOption('wing-01','hotel'),
    );
    expect(equipment).toHaveLength(1);
    expect(equipment[0].label).toBe('1. 設備機器');
    expect(equipment[0].slots).toHaveLength(7);
    expect(equipment[0].lines[0].group_label).toBe('１．設備機器');
    expect(JSON.stringify(slots)).toBe(old);
  });

  it('Wing/BOX/Flatのオプション見出し番号はExcel仕様ごとで変わる', () => {
    for (const [modelSlug,specCode,expected] of [
      ['wing-01','hotel','1. 設備機器'], ['wing-01','residence','1. 設備機器'],
      ['box','hotel','1. 設備機器'], ['box','water-kit','2. 設備機器'],
      ['flat','office','2. 設備機器'],
    ]) {
      const context = inOption(modelSlug,specCode);
      const mapped = v25WorkItemForCategory('ub',context);
      expect(mapped?.label).toBe(expected);
      expect(v25WorkItemForManual(expected,context).key).toBe(mapped?.key);
    }
    expect(v25OptionWorkItems(inOption('flat','office')).map(item=>item.label)).toEqual([
      '2. 設備機器','3. 造作工事','4. 各種養生（床養生マット、壁ビニールシート等）',
    ]);
    expect(v25WorkItemForCategory('carpentry',inOption('flat','office'))?.label).toBe('3. 造作工事');
    // 実際にはcarpentryは内外装に属するため、表示だけでオプションへ移動させない。
    expect(v25WorkItemForCategory('carpentry',inExterior('flat','office'))).toBeNull();
    expect(v25WorkItemForCategory('ub',inOption('flat','unknown'))).toBeNull();
  });

  it('断熱4種・施工費と不明商品は移動せず未分類。モデル不明のオプションは推測しない', () => {
    const categories = ['insulation','insulation-floor','insulation-wall','insulation-ceiling'];
    for(const [modelSlug,specCode] of [['wing-01','hotel'],['box','hotel'],['flat','office']]){
      for(const sectionCode of ['interior_exterior','option','sitework'] as const){
        const context = {modelSlug,specCode,sectionCode};
        for(const category of categories)expect(v25WorkItemForCategory(category,context)).toBeNull();
      }
    }
    for(const category of ['lighting','exterior-parts','carpentry','sitework','free-product','fireproof','closet','furniture']) {
      expect(v25WorkItemForCategory(category,inOption('wing-01','hotel'))).toBeNull();
    }
    expect(v25WorkItemForCategory('ub',{sectionCode:'option'})).toBeNull();
    expect(v25WorkItemForCategory('roof',{sectionCode:'sitework',modelSlug:'flat',specCode:'office'})).toBeNull();
    expect(v25WorkItemForManual('2. 屋根外壁工事',inExterior('box','hotel')).key).toBe('manual:2. 屋根外壁工事');
  });

  it('分類のみでは既存商品・手入力・保存payloadの数量・行順・金額を変えない', () => {
    const context = inOption('wing-01','hotel');
    const slots = [slot('ub','u'),slot('boiler','b'),slot('unknown','x')];
    const lines = [{...line('equipment','1. 設備機器'),section_code:'option' as const,unit_price:'6000',price_mode:'manual' as const}];
    const original = JSON.stringify({slots,lines});
    const display = v25WorkGroupsForDisplay(slots,lines,id=>({u:'ub',b:'boiler',x:'lighting'} as Record<string,string>)[id], l=>l.group_label,context);
    expect(display.map(g=>g.label)).toEqual(['1. 設備機器','工事項目未分類の商品']);
    expect(display[0].slots.map(s=>s.key)).toEqual(['ub','boiler']);
    const state: V25EditorState = {sales_fee_rate:'1',expense_rate:'0.15',markup_rate:'1.5',adjustment:'0',adjustment_reason:'',slots,lines};
    const payloadBefore = buildV25SavePayload(state);
    void v25WorkGroupsForDisplay(slots,lines,id=>({u:'ub',b:'boiler',x:'lighting'} as Record<string,string>)[id],l=>l.group_label,context);
    expect(buildV25SavePayload(state)).toEqual(payloadBefore);
    expect(JSON.stringify({slots,lines})).toBe(original);
    expect(source).toContain('modelSlug, specCode, sectionCode: code');
  });
});

describe('標準見積v2.5：全列結合の独立小計行／列表示・編集回帰', () => {
  it('小計だけを1セル＋表示列数で描画し、金額を右寄せして桁を揃える', () => {
    const subtotal = source.slice(source.indexOf('const sectionSubtotal ='), source.indexOf('  return (\n    <section className=', source.indexOf('const sectionSubtotal =')));
    expect(subtotal).toContain('bg-lime-100');
    expect(subtotal).toContain('colSpan={columnCount}');
    expect((subtotal.match(/<td\b/g) ?? [])).toHaveLength(1);
    expect(subtotal).toContain('justify-end');
    expect(subtotal).toContain('tabular-nums');
    expect(subtotal).toContain('whitespace-nowrap');
    expect(subtotal).toContain('data-testid={`v25-section-subtotal-value-${code}`}');
    expect(subtotal).toContain('result.subtotal');
    expect(subtotal).not.toContain('beforeSaleAmount');
    expect(subtotal).not.toContain('afterSaleAmount');
  });

  it('工事項目の重複表示を無くし、明示的なメニュー確定までgroup_labelを変更しない', () => {
    expect(source).toContain('const workGroups = v25WorkGroupsForDisplay(');
    expect(source).toContain('workGroups.map((workGroup)');
    expect(source).toContain('data-testid="v25-work-item-heading"');
    expect(source).toContain('data-work-item={workGroup.key}');
    expect(source).toContain('v25MixedRowsForWorkGroup(mixedOrder, workGroup).map((rowRef, rowIndex) => {');
    expect(source).toContain("if (rowRef.kind === 'slot')");
    expect(source).toContain('const line = workGroup.lines.find((item) => item.key === rowRef.key)');
    expect(source).toContain('data-v25-excel-col="name"');
    expect(source).not.toContain('data-v25-excel-col="group"');
    expect(source).toContain('data-testid="v25-wb-change-work-group"');
    expect(source).toContain('data-testid="v25-wb-work-group-dialog"');
    expect(source).toContain('value={groupEditor.value}');
    expect(source).toContain('setGroupEditor({ lineKey: line.key, originalLabel: line.group_label, value: line.group_label })');
    expect(source).toContain("if (groupEditor.value !== groupEditor.originalLabel) setLine(groupEditor.lineKey, { group_label: groupEditor.value })");
    expect(source).toContain('onClose={() => setGroupEditor(null)}');
    expect(source).toContain('dirty={groupEditor.value !== groupEditor.originalLabel}');
    expect(source).toContain("setJumpToKey({ key: groupEditor.lineKey })");
    expect(source).toContain('{!collapsed.has(code) && sectionSubtotal(code, STANDARD_SECTION_LABEL[code])}');
  });

  it('Tab・Enter明細フォーカス移動は保持し、編集ダイアログから分類変更しても行ID・数量を変えない', () => {
    const table = source.slice(source.indexOf('<table ref={tableRef}'), source.indexOf('</table>', source.indexOf('<table ref={tableRef}')));
    expect(table).toContain('onKeyDown={handleExcelNavigation}');
    expect(source).toContain('const handleExcelNavigation = (event: ReactKeyboardEvent<HTMLTableElement>) => {');
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain("event.key === 'Enter'");
    expect(source).toContain('event.shiftKey ? -1 : 1');
    expect(source).toContain('next.focus(); next.select();');
    expect(source).not.toContain('setEditingWorkGroup');
    expect(source).toContain('setLine(groupEditor.lineKey, { group_label: groupEditor.value })');
    expect(source).toContain('const setLine = (key: string, patch: Partial<V25LineRow>)');
    expect(source).toContain('lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line))');
  });

  it('明細行の右端6pxのみ既存の列幅変更へ渡し、結合行・メニュー操作を対象外とする', () => {
    expect(source).toContain('data-testid="v25-wb-resizable-body"');
    expect(source).toContain('onMouseDownCapture={startBodyResize}');
    expect(source).toContain('onMouseMoveCapture={showBodyResizeCursor}');
    expect(source).toContain('cell.colSpan !== 1');
    expect(source).toContain("['v25-wb-base-row', 'v25-wb-slot', 'v25-wb-line']");
    expect(source).toContain('displayedColumns[cell.cellIndex]');
    expect(source).toContain('edge >= 0 && edge <= 6');
    expect(source).toContain("target.closest('button, summary, a, select, textarea, [role=\"separator\"]')");
    expect(source).toContain('columnPrefs.startResize(event, candidate.id)');
    expect(source).toContain('V25WidthHandle');
    expect(source).toContain('v25GridWidth(columnPrefs.prefs)');
    expect(source).toContain('columnPrefs.reset');
  });

  it('↑↓＋とドラッグは同じ行移動経路を使用し、工事項目間でも移動する', () => {
    expect(source).toContain('v25MixedRowsForWorkGroup(mixedOrder, workGroup).map((rowRef, rowIndex) => {');
    expect(source).toContain('v25ArrowRowTarget(');
    expect(source).toContain('v25PlanMixedRowMove(');
    expect(source).toContain('data-testid="v25-wb-row-up"');
    expect(source).toContain('data-testid="v25-wb-row-down"');
    expect(source).toContain('testId="v25-wb-row-insert"');
    expect(source).toContain('<V25RowDragHandle');
    expect(source).toContain('data-testid="v25-wb-drop-indicator"');
    expect(source).not.toContain('data-testid="v25-wb-manual-move-up"');
    expect(source).not.toContain('data-testid="v25-wb-manual-move-down"');
    expect(source).toContain('testId="v25-wb-line-menu"');
    expect(source).toContain('<V25RowDeleteButton inMenu');
    expect(source).toContain('testId="v25-wb-line-delete"');
    expect(source).toContain('data-v25-excel-col="name"');
    expect(source).toContain('data-testid="v25-wb-change-work-group"');
    expect(source).toContain('data-v25-column="actions"');
    expect(source).toContain('style={{ width: columnPrefs.prefs.widths.actions }}');
  });

  it('現行RPCと読込・公開後の見積出力は配列順を使用し、DB変更不要', () => {
    const rpc = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261102100000_v25_position_slots.sql'), 'utf8');
    const loader = readFileSync(resolve(process.cwd(), 'lib/data/standard-estimate-v25.ts'), 'utf8');
    const view = readFileSync(resolve(process.cwd(), 'lib/domain/standard-estimate-v25-view.ts'), 'utf8');
    expect(rpc).toContain("for item in select x.value from pg_catalog.jsonb_array_elements(p_payload -> 'lines') x loop");
    expect(rpc).toContain('v_index := v_index + 1;');
    expect(rpc).toContain('coalesce((item ->> \'review_required\')::boolean, false), v_index');
    expect(loader).toContain(".from('standard_estimate_revision_v25_lines')");
    expect(loader).toContain(".order('sort_order')");
    expect(loader).toContain('lines: lines.map((line) => ({');
    expect(view).toContain('lines: state.lines.map((line) => ({');
    expect(rpc).toContain("pg_catalog.lpad((100000 + l.sort_order)::text, 6, '0') || '-b'");
    expect(rpc).toContain("pg_catalog.jsonb_agg(x.line order by x.sort_key)");
    expect(rpc).toContain("jsonb_array_elements(v_view -> 'lines') with ordinality as l(value, ordinality)");
    expect(rpc).toContain("v_base_sort + l.ordinality::integer");
  });

  it('列の表示/非表示と幅調整、固定見出し、保存のpayloadは既存のまま', () => {
    expect(source).toContain('const columnCount = displayedColumns.length;');
    expect(source).toContain('v25GridWidth(columnPrefs.prefs)');
    expect(source).toContain('V25ColumnDisplayMenu');
    expect(source).toContain('V25WidthHandle');
    expect(source).toContain('useV25PageFloatingHeader(headerLayoutKey)');
    expect(source).toContain('overlay.scrollLeft = grid.scrollLeft');
    expect(source).toContain('buildV25SavePayload(orderedToSave)');
    expect(source).toContain('saveStandardEstimateV25DraftAction');
    expect(source).toContain('clearV25Position(state, positionFor)');
    expect(source).toContain('updateV25Position(state, positionFor, positionDraft.slot_label');
  });
});
