'use client';

import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';

type Section = '本体' | '内外装工事' | 'オプション' | '別途';
type Sheet = 'cost' | 'sale' | 'compare';

export interface EstimateExcelDemoProduct {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  manufacturer: string;
  modelNo: string;
  sizeNote: string;
  price: number;
  priceOnRequest: boolean;
}

interface Row {
  id: string;
  section: Section;
  group: string;
  name: string;
  quantity: number;
  unit: string;
  cost: number;
  sale: number;
  manualSale: boolean;
  priceOnRequest: boolean;
  previousSale: number | null;
  previousManualSale: boolean | null;
  remark: string;
  manufacturer?: string;
  modelNo?: string;
  userAdded?: boolean;
}

const SECTIONS: Section[] = ['本体', '内外装工事', 'オプション', '別途'];

const INITIAL_ROWS: Row[] = [
  { id: 'b1', section: '本体', group: '金物関係費用', name: '単管パイプ2.5m', quantity: 12, unit: '本', cost: 1349, sale: 2158, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '' },
  { id: 'b2', section: '本体', group: '金物関係費用', name: 'ジャッキベース', quantity: 12, unit: '本', cost: 2500, sale: 4000, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '' },
  { id: 'b3', section: '本体', group: '本体', name: '本体組立費', quantity: 5, unit: '人', cost: 25000, sale: 40000, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '' },
  { id: 'b4', section: '本体', group: '本体', name: 'その他本体明細（Excel集約）', quantity: 1, unit: '式', cost: 612959, sale: 980489, manualSale: true, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '操作確認用に元Excelの残明細を集約' },

  { id: 'i1', section: '内外装工事', group: 'サッシ木製建具工事', name: 'サッシ 玄関ドア', quantity: 1, unit: '台', cost: 180000, sale: 288000, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '' },
  { id: 'i2', section: '内外装工事', group: 'サッシ木製建具工事', name: '勝手口ドア', quantity: 1, unit: '台', cost: 180000, sale: 288000, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '' },
  { id: 'i3', section: '内外装工事', group: '外壁工事', name: 'ガルバリウム鋼板関係', quantity: 1, unit: '式', cost: 174235, sale: 278776, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '屋根外壁1式' },
  { id: 'i4', section: '内外装工事', group: '外壁工事', name: '下見板張り（防腐剤塗り共）', quantity: 17.6, unit: '㎡', cost: 7800, sale: 12480, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '' },
  { id: 'i5', section: '内外装工事', group: '内外装工事', name: 'その他内外装明細（Excel集約）', quantity: 1, unit: '式', cost: 934552, sale: 1495280, manualSale: true, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '操作確認用に元Excelの残明細を集約' },

  { id: 'o1', section: 'オプション', group: '設備機器', name: 'ユニットバス1216', quantity: 1, unit: '台', cost: 380000, sale: 608000, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '' },
  { id: 'o2', section: 'オプション', group: '設備機器', name: 'ウォッシュレット', quantity: 1, unit: '台', cost: 150000, sale: 240000, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '' },
  { id: 'o3', section: 'オプション', group: '設備機器', name: 'エアコン', quantity: 1, unit: '台', cost: 250000, sale: 400000, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '' },
  { id: 'o4', section: 'オプション', group: '設備機器', name: '設備取付関係', quantity: 5, unit: '人', cost: 25000, sale: 25000, manualSale: true, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '元Excelの手動売価' },
  { id: 'o5', section: 'オプション', group: 'オプション', name: 'その他オプション明細（Excel集約）', quantity: 1, unit: '式', cost: 641150, sale: 1025840, manualSale: false, priceOnRequest: false, previousSale: null, previousManualSale: null, remark: '操作確認用に元Excelの残明細を集約' },

  { id: 's1', section: '別途', group: '運送費', name: '運送費', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, previousSale: null, previousManualSale: null, remark: '' },
  { id: 's2', section: '別途', group: '設計監理', name: '設計監理及び確認申請費', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, previousSale: null, previousManualSale: null, remark: '' },
  { id: 's3', section: '別途', group: '梱包養生', name: '梱包養生', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, previousSale: null, previousManualSale: null, remark: '' },
  { id: 's4', section: '別途', group: '現場設置工事', name: '現場設置工事', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, previousSale: null, previousManualSale: null, remark: '' },
  { id: 's5', section: '別途', group: '電気設備工事', name: '照明器具含む', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, previousSale: null, previousManualSale: null, remark: '' },
  { id: 's6', section: '別途', group: '給排水給湯設備工事', name: '敷地状況によって別途見積', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, previousSale: null, previousManualSale: null, remark: '' },
  { id: 's7', section: '別途', group: '基礎工事', name: '基礎工事（設置後工事）', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, previousSale: null, previousManualSale: null, remark: '' },
  { id: 's8', section: '別途', group: '廃材処分費', name: '廃材処分費', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, previousSale: null, previousManualSale: null, remark: '' },
  { id: 's9', section: '別途', group: '現場諸費用', name: '別途現場諸費用', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, previousSale: null, previousManualSale: null, remark: '' },
];

const yen = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const money = (value: number) => '¥' + yen.format(value);
const percent = (value: number) => pct.format(value) + '%';
const floorYen = (value: number) => Math.floor(value + 1e-9);
const cloneRows = () => INITIAL_ROWS.map((row) => ({ ...row }));

export function EstimateTemplateExcelDemo({ products }: { products: EstimateExcelDemoProduct[] }) {
  const [rows, setRows] = useState<Row[]>(cloneRows);
  const [sheet, setSheet] = useState<Sheet>('compare');
  const [collapsed, setCollapsed] = useState<Set<Section>>(() => new Set());
  const [expenseRate, setExpenseRate] = useState(15);
  const [markupRate, setMarkupRate] = useState(160);
  const [costAdjustment, setCostAdjustment] = useState(-818);
  const [saleAdjustment, setSaleAdjustment] = useState(-137);
  const [dirty, setDirty] = useState(false);
  const [undoRows, setUndoRows] = useState<Row[] | null>(null);
  const [pickerSection, setPickerSection] = useState<Section | null>(null);
  const [replaceRowId, setReplaceRowId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedCell, setSelectedCell] = useState('選択したセルの内容を表示');

  const rowCost = (row: Row) => row.quantity * row.cost;
  const rowSale = (row: Row) => row.priceOnRequest ? 0 : row.quantity * row.sale;

  const expense = (section: Section, side: 'cost' | 'sale') => {
    if (section === '別途') return 0;
    const base = rows.filter((row) => row.section === section).reduce((sum, row) => sum + (side === 'cost' ? rowCost(row) : rowSale(row)), 0);
    const value = base * (expenseRate / 100);
    return section === 'オプション' ? floorYen(value) : value;
  };

  const sectionTotals = new Map<Section, { cost: number; sale: number; profit: number; margin: number }>(
    SECTIONS.map((section) => {
      const sectionRows = rows.filter((row) => row.section === section);
      const cost = sectionRows.reduce((sum, row) => sum + rowCost(row), 0) + expense(section, 'cost');
      const sale = sectionRows.reduce((sum, row) => sum + rowSale(row), 0) + expense(section, 'sale');
      const profit = sale - cost;
      return [section, { cost, sale, profit, margin: sale ? profit / sale * 100 : 0 }];
    })
  );

  const costSubtotal = SECTIONS.reduce((sum, section) => sum + (sectionTotals.get(section)?.cost ?? 0), 0);
  const saleSubtotal = SECTIONS.reduce((sum, section) => sum + (sectionTotals.get(section)?.sale ?? 0), 0);
  const costTax = floorYen((costSubtotal + costAdjustment) * 0.1);
  const saleTax = floorYen((saleSubtotal + saleAdjustment) * 0.1);
  const costGrand = costSubtotal + costAdjustment + costTax;
  const saleGrand = saleSubtotal + saleAdjustment + saleTax;
  const profit = saleGrand - costGrand;
  const totals = {
    costSubtotal,
    saleSubtotal,
    costTax,
    saleTax,
    costGrand,
    saleGrand,
    profit,
    margin: saleGrand ? profit / saleGrand * 100 : 0,
    onRequest: rows.filter((row) => row.priceOnRequest).length,
  };

  const pickerProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => !q || [product.categoryName, product.manufacturer, product.name, product.modelNo].join(' ').toLowerCase().includes(q));
  }, [products, query]);

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    setDirty(true);
  };

  const cellKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-estimate-cell="1"]'));
    const current = event.currentTarget;
    if (event.key === 'Tab') {
      event.preventDefault();
      const index = inputs.indexOf(current);
      const next = event.shiftKey ? inputs[index - 1] : inputs[index + 1];
      next?.focus();
      next?.select();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const col = current.dataset.col;
      const rowIndex = Number(current.dataset.row ?? -1);
      const candidates = inputs.filter((input) => input.dataset.col === col);
      const next = event.shiftKey
        ? [...candidates].reverse().find((input) => Number(input.dataset.row) < rowIndex)
        : candidates.find((input) => Number(input.dataset.row) > rowIndex);
      next?.focus();
      next?.select();
    }
  };

  const cellProps = (col: string, row: number) => ({ 'data-estimate-cell': '1', 'data-col': col, 'data-row': row, onKeyDown: cellKey });

  const applyMarkup = () => {
    const auto = rows.filter((row) => row.cost > 0 && !row.manualSale && !row.priceOnRequest).length;
    const manual = rows.filter((row) => row.manualSale && !row.priceOnRequest).length;
    const separate = rows.filter((row) => row.priceOnRequest).length;
    if (!window.confirm('自動計算 ' + auto + '件を掛率 ' + markupRate.toFixed(2) + '% で再計算します。\n手動 ' + manual + '件・別途見積 ' + separate + '件は変更しません。\n実行しますか？')) return;
    setUndoRows(rows.map((row) => ({ ...row })));
    setRows((current) => current.map((row) => row.cost > 0 && !row.manualSale && !row.priceOnRequest ? { ...row, sale: floorYen(row.cost * markupRate / 100) } : row));
    setDirty(true);
  };

  const reset = () => {
    if (dirty && !window.confirm('未保存の変更を破棄して、保存時点の内容に戻しますか？')) return;
    setRows(cloneRows());
    setExpenseRate(15);
    setMarkupRate(160);
    setCostAdjustment(-818);
    setSaleAdjustment(-137);
    setCollapsed(new Set());
    setUndoRows(null);
    setDirty(false);
  };

  const toggleSeparate = (row: Row, enabled: boolean) => {
    if (enabled) {
      updateRow(row.id, { previousSale: row.sale, previousManualSale: row.manualSale, priceOnRequest: true, manualSale: false });
    } else {
      const restore = row.previousManualSale === true && row.previousSale !== null;
      updateRow(row.id, {
        priceOnRequest: false,
        sale: restore ? row.previousSale ?? 0 : floorYen(row.cost * markupRate / 100),
        manualSale: restore,
        previousSale: null,
        previousManualSale: null,
      });
    }
  };

  const addFree = (section: Section) => {
    setRows((current) => [...current, {
      id: 'free-' + Date.now(), section, group: '新規', name: '新しい自由項目', quantity: 1, unit: '式',
      cost: 0, sale: 0, manualSale: false, priceOnRequest: section === '別途', previousSale: null,
      previousManualSale: null, remark: '', userAdded: true,
    }]);
    setDirty(true);
  };

  const chooseProduct = (product: EstimateExcelDemoProduct) => {
    const section = pickerSection ?? 'オプション';
    const patch: Partial<Row> = {
      group: product.categoryName,
      name: product.name,
      manufacturer: product.manufacturer,
      modelNo: product.modelNo,
      sale: product.priceOnRequest ? 0 : product.price,
      manualSale: !product.priceOnRequest,
      priceOnRequest: product.priceOnRequest,
      remark: product.priceOnRequest ? '別途見積' : '商品マスター販売価格を手動売価として反映',
    };
    if (replaceRowId) updateRow(replaceRowId, patch);
    else {
      setRows((current) => [...current, {
        id: 'product-' + product.id + '-' + Date.now(), section, group: product.categoryName, name: product.name,
        quantity: 1, unit: '式', cost: 0, sale: product.priceOnRequest ? 0 : product.price,
        manualSale: !product.priceOnRequest, priceOnRequest: product.priceOnRequest, previousSale: null,
        previousManualSale: null, remark: product.priceOnRequest ? '別途見積' : '商品マスター販売価格を手動売価として反映',
        manufacturer: product.manufacturer, modelNo: product.modelNo, userAdded: true,
      }]);
      setDirty(true);
    }
    setPickerSection(null);
    setReplaceRowId(null);
    setQuery('');
  };

  const tableHeaders = sheet === 'compare'
    ? ['#', '', '項目', 'グループ', '数量', '単位', '原価単価', '原価金額', '販売単価', '販売金額', '粗利', '粗利率', '備考', '操作']
    : sheet === 'cost'
      ? ['#', '', '項目', 'グループ', '数量', '単位', '原価単価', '原価金額', '備考', '操作']
      : ['#', '', '項目', 'グループ', '数量', '単位', '販売単価', '販売金額', '備考', '操作'];

  const renderInput = (row: Row, rowIndex: number, field: 'name' | 'group' | 'unit' | 'remark', col: string) => (
    <input
      {...cellProps(col, rowIndex)}
      value={row[field]}
      onFocus={(event) => setSelectedCell(event.currentTarget.value)}
      onChange={(event) => {
        setSelectedCell(event.target.value);
        updateRow(row.id, { [field]: event.target.value });
      }}
      className="h-8 w-full border-0 bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-emerald-700/30"
    />
  );

  const renderSaleInput = (row: Row, rowIndex: number) => {
    if (row.priceOnRequest) return (
      <div className="flex items-center justify-end gap-2 px-2">
        <span className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">別途見積</span>
        <button type="button" className="text-[10px] text-emerald-800 underline" onClick={() => toggleSeparate(row, false)}>金額入力</button>
      </div>
    );
    return (
      <div className="px-1 py-1">
        <div className="flex items-center gap-1">
          <input
            {...cellProps('S', rowIndex)}
            type="number" min={0} step={1} value={row.sale}
            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
            onChange={(event) => {
              const value = Math.max(0, Number(event.target.value) || 0);
              setSelectedCell(event.target.value);
              updateRow(row.id, { sale: value, manualSale: true, priceOnRequest: false });
            }}
            className="h-8 w-full border-0 bg-transparent px-2 text-right text-sm outline-none focus:ring-2 focus:ring-emerald-700/30"
          />
          <button
            type="button"
            onClick={() => row.manualSale && updateRow(row.id, { sale: floorYen(row.cost * markupRate / 100), manualSale: false })}
            className={row.manualSale ? 'rounded border border-orange-300 bg-orange-50 px-1.5 py-1 text-[10px] font-semibold text-orange-800' : 'rounded border border-emerald-300 bg-emerald-50 px-1.5 py-1 text-[10px] font-semibold text-emerald-800'}
          >
            {row.manualSale ? '手動' : '自動'}
          </button>
        </div>
        <button type="button" className="px-2 pt-1 text-[10px] text-slate-500 underline" onClick={() => toggleSeparate(row, true)}>別途見積にする</button>
      </div>
    );
  };

  let rowCounter = 0;

  return (
    <div className="space-y-4">
      <section className="sticky top-0 z-30 rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <p className="font-semibold">見積テンプレート編集 ― Excel照合版</p>
            <p className="mt-1 text-xs text-slate-500">Wing／ホテルUB／非防火　元Excelの計算ルールを反映したReact操作確認版です。</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={dirty ? 'rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900' : 'rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800'}>
              {dirty ? '未保存の変更あり' : '保存時点と同じ'}
            </span>
            <button type="button" className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold" onClick={reset}>保存時点に戻す</button>
          </div>
        </div>

        <div className="flex flex-wrap divide-x divide-slate-200 border-b border-slate-200 text-sm">
          <label className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">販売費</span><input value="100.00" disabled className="w-20 rounded border border-slate-200 bg-slate-100 px-2 py-1 text-right" /><span>%</span><small className="text-[10px] text-slate-400">原価単価へ反映済み</small></label>
          <label className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">経費</span><input type="number" min={0} step={0.01} value={expenseRate} onChange={(event) => { setExpenseRate(Math.max(0, Number(event.target.value) || 0)); setDirty(true); }} className="w-20 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-right" /><span>%</span></label>
          <label className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">掛率</span><input type="number" min={0} step={0.01} value={markupRate} onChange={(event) => { setMarkupRate(Math.max(0, Number(event.target.value) || 0)); setDirty(true); }} className="w-20 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-right" /><span>%</span></label>
          <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">粗利（Excel式）</span><strong>{Math.floor(totals.profit).toLocaleString('ja-JP')}円也</strong></div>
          <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">粗利率</span><strong>{percent(totals.margin)}</strong></div>
          <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">別途見積</span><strong className="text-amber-800">{totals.onRequest}件</strong></div>
        </div>
        <div className="bg-amber-50 px-4 py-1.5 text-[11px] text-amber-900">
          Excel照合ルール：売価単価＝ROUNDDOWN(原価単価×掛率,0) ／ 経費＝区分明細小計×15% ／ 消費税＝ROUNDDOWN(調整後金額×10%,0) ／ 粗利＝売価税込合計－原価税込合計
        </div>
      </section>

      <section className="rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
          <div className="flex gap-2">
            <button type="button" onClick={applyMarkup} className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold">掛率から売価を再計算</button>
            <button type="button" disabled={!undoRows} onClick={() => { if (undoRows) { setRows(undoRows.map((row) => ({ ...row }))); setUndoRows(null); setDirty(true); } }} className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40">直前の再計算を元に戻す</button>
          </div>
          <p className="text-[11px] text-slate-500">黄色＝金額入力 ／ 商品名「…」＝商品選択 ／ Tab＝右 ／ Enter＝下</p>
        </div>

        <div className="flex border-b border-slate-300 bg-slate-100 px-3 pt-2">
          {([['cost', '原価表'], ['sale', '売価表'], ['compare', '原価・売価比較']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setSheet(value)} className={sheet === value ? 'border-x border-t border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-emerald-900' : 'px-5 py-2 text-sm text-slate-600'}>{label}</button>
          ))}
        </div>

        <div className="flex border-b border-slate-200 text-xs">
          <div className="w-16 border-r border-slate-200 bg-slate-100 px-2 py-2 font-semibold text-slate-500">内容</div>
          <div className="min-h-8 flex-1 px-3 py-2">{selectedCell}</div>
        </div>

        <div className="max-h-[68vh] overflow-auto">
          <table className={sheet === 'compare' ? 'min-w-[110rem] border-collapse' : 'min-w-[84rem] border-collapse'}>
            <thead>
              <tr>{tableHeaders.map((label, index) => <th key={label + index} className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-2 py-2 text-center text-xs font-semibold text-slate-600">{label}</th>)}</tr>
            </thead>
            <tbody>
              {SECTIONS.map((section) => {
                const sectionRows = rows.filter((row) => row.section === section);
                const isCollapsed = collapsed.has(section);
                const st = sectionTotals.get(section) ?? { cost: 0, sale: 0, profit: 0, margin: 0 };
                const currentRows = sectionRows.map((row) => {
                  rowCounter += 1;
                  const index = rowCounter;
                  const costAmount = rowCost(row);
                  const saleAmount = rowSale(row);
                  const profit = saleAmount - costAmount;
                  const margin = saleAmount ? profit / saleAmount * 100 : 0;
                  const common = [
                    <th key="n" className="w-12 bg-slate-100 px-2 text-center text-xs font-normal text-slate-500">{index}</th>,
                    <td key="x" className="w-8 border-r border-slate-200 bg-white"></td>,
                    <td key="name" className="relative min-w-[18rem] border-r border-slate-200 bg-white px-1 py-1">
                      {renderInput(row, index, 'name', 'N')}
                      <button type="button" className="absolute right-2 top-2 grid size-6 place-items-center rounded border border-slate-300 bg-white text-xs font-bold" onClick={() => { setReplaceRowId(row.id); setPickerSection(section); }}>…</button>
                      {(row.manufacturer || row.modelNo) && <p className="truncate px-2 text-[11px] text-slate-500">{[row.manufacturer, row.modelNo].filter(Boolean).join(' ／ ')}</p>}
                    </td>,
                    <td key="group" className="min-w-40 border-r border-slate-200 bg-white px-1 py-1">{renderInput(row, index, 'group', 'G')}</td>,
                    <td key="qty" className="w-24 border-r border-slate-200 bg-white px-1 py-1"><input {...cellProps('Q', index)} type="number" min={0} step={0.1} value={row.quantity} onFocus={(event) => setSelectedCell(event.currentTarget.value)} onChange={(event) => updateRow(row.id, { quantity: Math.max(0, Number(event.target.value) || 0) })} className="h-8 w-full border-0 bg-transparent px-2 text-right text-sm outline-none focus:ring-2 focus:ring-emerald-700/30" /></td>,
                    <td key="unit" className="w-20 border-r border-slate-200 bg-white px-1 py-1">{renderInput(row, index, 'unit', 'U')}</td>,
                  ];

                  const remark = <td className="min-w-48 border-r border-slate-200 bg-white px-1 py-1">{renderInput(row, index, 'remark', 'R')}</td>;
                  const action = <td className="w-20 bg-white px-2 text-center">{row.userAdded ? <button type="button" className="text-xs text-red-700 underline" onClick={() => { setRows((current) => current.filter((item) => item.id !== row.id)); setDirty(true); }}>削除</button> : '—'}</td>;

                  if (sheet === 'cost') return <tr key={row.id} className="border-b border-slate-200">{common}<td className="w-32 border-r border-slate-200 bg-amber-50 px-1"><input {...cellProps('C', index)} type="number" min={0} step={1} value={row.cost} onChange={(event) => updateRow(row.id, { cost: Math.max(0, Number(event.target.value) || 0) })} className="h-8 w-full border-0 bg-transparent px-2 text-right text-sm outline-none" /></td><td className="w-32 border-r border-slate-200 bg-slate-50 px-3 text-right">{money(costAmount)}</td>{remark}{action}</tr>;
                  if (sheet === 'sale') return <tr key={row.id} className="border-b border-slate-200">{common}<td className="min-w-44 border-r border-slate-200 bg-amber-50">{renderSaleInput(row, index)}</td><td className="w-36 border-r border-slate-200 bg-slate-50 px-3 text-right">{row.priceOnRequest ? '別途見積' : money(saleAmount)}</td>{remark}{action}</tr>;
                  return <tr key={row.id} className="border-b border-slate-200">{common}<td className="w-32 border-r border-slate-200 bg-amber-50 px-1"><input {...cellProps('C', index)} type="number" min={0} step={1} value={row.cost} onChange={(event) => updateRow(row.id, { cost: Math.max(0, Number(event.target.value) || 0) })} className="h-8 w-full border-0 bg-transparent px-2 text-right text-sm outline-none" /></td><td className="w-32 border-r border-slate-200 bg-slate-50 px-3 text-right">{money(costAmount)}</td><td className="min-w-44 border-r border-slate-200 bg-amber-50">{renderSaleInput(row, index)}</td><td className="w-36 border-r border-slate-200 bg-slate-50 px-3 text-right">{row.priceOnRequest ? '別途見積' : money(saleAmount)}</td><td className="w-36 border-r border-slate-200 bg-slate-50 px-3 text-right">{row.priceOnRequest ? '—' : money(profit)}</td><td className="w-24 border-r border-slate-200 bg-slate-50 px-3 text-right">{row.priceOnRequest ? '—' : percent(margin)}</td>{remark}{action}</tr>;
                });

                const expenseCost = expense(section, 'cost');
                const expenseSale = expense(section, 'sale');
                return [
                  !isCollapsed && <tr key={section + '-head'} className="border-b border-slate-300 bg-emerald-900 text-white"><th className="bg-slate-100"></th><td></td><td colSpan={tableHeaders.length - 2} className="px-3 py-2 text-sm font-semibold">{section}</td></tr>,
                  !isCollapsed && currentRows,
                  !isCollapsed && section !== '別途' && (sheet === 'compare'
                    ? <tr key={section + '-expense'} className="border-b border-dashed border-slate-300 bg-stone-50 text-sm font-medium"><th className="bg-slate-100"></th><td></td><td className="px-3 py-2">{section}経費</td><td></td><td className="text-center">1</td><td className="text-center">式</td><td></td><td className="px-3 text-right">{money(expenseCost)}</td><td></td><td className="px-3 text-right">{money(expenseSale)}</td><td className="px-3 text-right">{money(expenseSale - expenseCost)}</td><td className="px-3 text-right">{percent(expenseSale ? (expenseSale - expenseCost) / expenseSale * 100 : 0)}</td><td className="px-3 text-xs text-slate-500">経費 {expenseRate.toFixed(2)}%</td><td></td></tr>
                    : <tr key={section + '-expense'} className="border-b border-dashed border-slate-300 bg-stone-50 text-sm font-medium"><th className="bg-slate-100"></th><td></td><td className="px-3 py-2">{section}経費</td><td></td><td className="text-center">1</td><td className="text-center">式</td><td></td><td className="px-3 text-right">{money(sheet === 'cost' ? expenseCost : expenseSale)}</td><td className="px-3 text-xs text-slate-500">経費 {expenseRate.toFixed(2)}%</td><td></td></tr>),
                  sheet === 'compare'
                    ? <tr key={section + '-total'} className="border-y-2 border-emerald-800 bg-emerald-50 font-semibold"><th className="bg-slate-100"></th><td className="px-1 py-2 text-center"><button type="button" className="size-6 rounded border border-slate-400 bg-white" onClick={() => setCollapsed((current) => { const next = new Set(current); next.has(section) ? next.delete(section) : next.add(section); return next; })}>{isCollapsed ? '+' : '−'}</button></td><td className="px-3 py-2">{section} 計</td><td></td><td className="text-center">{isCollapsed ? '1' : ''}</td><td className="text-center">{isCollapsed ? '式' : ''}</td><td></td><td className="px-3 text-right">{money(st.cost)}</td><td></td><td className="px-3 text-right">{money(st.sale)}</td><td className="px-3 text-right">{money(st.profit)}</td><td className="px-3 text-right">{percent(st.margin)}</td><td></td><td className="px-2 text-right"><button type="button" className="mr-2 text-[11px] text-emerald-800 underline" onClick={() => addFree(section)}>＋自由項目</button><button type="button" className="text-[11px] text-emerald-800 underline" onClick={() => { setReplaceRowId(null); setPickerSection(section); }}>＋商品</button></td></tr>
                    : <tr key={section + '-total'} className="border-y-2 border-emerald-800 bg-emerald-50 font-semibold"><th className="bg-slate-100"></th><td className="px-1 py-2 text-center"><button type="button" className="size-6 rounded border border-slate-400 bg-white" onClick={() => setCollapsed((current) => { const next = new Set(current); next.has(section) ? next.delete(section) : next.add(section); return next; })}>{isCollapsed ? '+' : '−'}</button></td><td className="px-3 py-2">{section} 計</td><td></td><td className="text-center">{isCollapsed ? '1' : ''}</td><td className="text-center">{isCollapsed ? '式' : ''}</td><td></td><td className="px-3 text-right">{money(sheet === 'cost' ? st.cost : st.sale)}</td><td></td><td className="px-2 text-right"><button type="button" className="mr-2 text-[11px] text-emerald-800 underline" onClick={() => addFree(section)}>＋自由項目</button><button type="button" className="text-[11px] text-emerald-800 underline" onClick={() => { setReplaceRowId(null); setPickerSection(section); }}>＋商品</button></td></tr>,
                ];
              })}
            </tbody>
            <tfoot className="bg-slate-50 text-sm font-semibold">
              {sheet === 'cost' && <><tr className="border-t-2 border-slate-600"><td colSpan={7} className="px-3 py-2 text-right">原価小計</td><td className="px-3 text-right">{money(totals.costSubtotal)}</td><td colSpan={2}></td></tr><tr><td colSpan={7} className="px-3 py-2 text-right">原価調整額</td><td className="px-1"><input type="number" value={costAdjustment} onChange={(event) => { setCostAdjustment(Number(event.target.value) || 0); setDirty(true); }} className="w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-right" /></td><td colSpan={2}></td></tr><tr><td colSpan={7} className="px-3 py-2 text-right">原価消費税 10%</td><td className="px-3 text-right">{money(totals.costTax)}</td><td colSpan={2}></td></tr><tr className="border-t-2 border-slate-600"><td colSpan={7} className="px-3 py-3 text-right">原価税込合計</td><td className="px-3 text-right text-base">{money(totals.costGrand)}</td><td colSpan={2}></td></tr></>}
              {sheet === 'sale' && <><tr className="border-t-2 border-slate-600"><td colSpan={7} className="px-3 py-2 text-right">売価小計</td><td className="px-3 text-right">{money(totals.saleSubtotal)}</td><td colSpan={2}></td></tr><tr><td colSpan={7} className="px-3 py-2 text-right">売価調整額</td><td className="px-1"><input type="number" value={saleAdjustment} onChange={(event) => { setSaleAdjustment(Number(event.target.value) || 0); setDirty(true); }} className="w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-right" /></td><td colSpan={2}></td></tr><tr><td colSpan={7} className="px-3 py-2 text-right">売価消費税 10%</td><td className="px-3 text-right">{money(totals.saleTax)}</td><td colSpan={2}></td></tr><tr className="border-t-2 border-slate-600"><td colSpan={7} className="px-3 py-3 text-right">売価税込合計</td><td className="px-3 text-right text-base">{money(totals.saleGrand)}</td><td colSpan={2}></td></tr></>}
              {sheet === 'compare' && <><tr className="border-t-2 border-slate-600"><td colSpan={7} className="px-3 py-2 text-right">税抜小計</td><td className="px-3 text-right">{money(totals.costSubtotal)}</td><td></td><td className="px-3 text-right">{money(totals.saleSubtotal)}</td><td className="px-3 text-right">{money(totals.saleSubtotal - totals.costSubtotal)}</td><td colSpan={3}></td></tr><tr><td colSpan={7} className="px-3 py-2 text-right">調整額</td><td className="px-3 text-right">{money(costAdjustment)}</td><td></td><td className="px-3 text-right">{money(saleAdjustment)}</td><td className="px-3 text-right">{money(saleAdjustment - costAdjustment)}</td><td colSpan={3}></td></tr><tr><td colSpan={7} className="px-3 py-2 text-right">消費税</td><td className="px-3 text-right">{money(totals.costTax)}</td><td></td><td className="px-3 text-right">{money(totals.saleTax)}</td><td className="px-3 text-right">{money(totals.saleTax - totals.costTax)}</td><td colSpan={3}></td></tr><tr className="border-t-2 border-slate-700"><td colSpan={7} className="px-3 py-3 text-right">税込合計</td><td className="px-3 text-right text-base">{money(totals.costGrand)}</td><td></td><td className="px-3 text-right text-base">{money(totals.saleGrand)}</td><td className="px-3 text-right text-base">{money(totals.profit)}</td><td className="px-3 text-right">{percent(totals.margin)}</td><td colSpan={2}></td></tr></>}
            </tfoot>
          </table>
        </div>
      </section>

      {pickerSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[86vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div><h2 className="font-semibold">商品を選択</h2><p className="text-xs text-slate-500">追加・変更先：{pickerSection}</p></div>
              <button type="button" onClick={() => { setPickerSection(null); setReplaceRowId(null); }} className="rounded border border-slate-300 px-3 py-2 text-xs">閉じる</button>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">現在の商品マスターはこの画面用の原価を保持していないため、選択時は登録済み追加金額を手動売価として反映します。原価連携は今回の操作確認PRでは変更しません。</div>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="メーカー・商品名・型番で検索" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
              <div className="grid gap-3 sm:grid-cols-2">
                {pickerProducts.map((product) => <article key={product.id} className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">{product.categoryName} ／ {product.manufacturer || 'メーカー未登録'}</p><h3 className="mt-1 font-semibold">{product.name}</h3><p className="mt-1 text-xs text-slate-500">{product.modelNo || '型番未登録'}</p><div className="mt-3 flex items-center justify-between"><strong className="text-sm">{product.priceOnRequest ? '別途見積' : '追加金額 ' + money(product.price)}</strong><button type="button" onClick={() => chooseProduct(product)} className="rounded bg-emerald-800 px-3 py-2 text-xs font-semibold text-white">選択</button></div></article>)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
