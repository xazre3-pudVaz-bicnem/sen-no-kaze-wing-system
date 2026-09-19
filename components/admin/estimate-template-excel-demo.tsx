'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

type Section = '本体' | '内外装工事' | 'オプション' | '別途';

type DemoRow = {
  id: string;
  section: Section;
  name: string;
  quantity: number;
  unit: string;
  cost: number;
  sale: number;
  manualSale: boolean;
  priceOnRequest: boolean;
  previousSale?: number | null;
  previousManualSale?: boolean | null;
  manufacturer?: string;
  modelNo?: string;
  remark: string;
  source: 'base' | 'product' | 'free';
};

type DemoProduct = {
  id: string;
  category: string;
  name: string;
  manufacturer: string;
  modelNo: string;
  price: number;
  priceOnRequest: boolean;
};

const SECTIONS: Section[] = ['本体', '内外装工事', 'オプション', '別途'];

const INITIAL_ROWS: DemoRow[] = [
  { id: 'b1', section: '本体', name: '単管パイプ2.5m', quantity: 12, unit: '本', cost: 1349, sale: 2158, manualSale: false, priceOnRequest: false, remark: '', source: 'base' },
  { id: 'b2', section: '本体', name: '本体組立費', quantity: 5, unit: '人', cost: 25000, sale: 40000, manualSale: false, priceOnRequest: false, remark: '', source: 'base' },
  { id: 'b3', section: '本体', name: '本体その他明細（集約）', quantity: 1, unit: '式', cost: 3858812, sale: 5524104, manualSale: false, priceOnRequest: false, remark: '本体マスター参照の操作確認用集約', source: 'base' },

  { id: 'i1', section: '内外装工事', name: 'ガルバリウム鋼板関係', quantity: 1, unit: '式', cost: 174235, sale: 278776, manualSale: false, priceOnRequest: false, remark: '屋根外壁1式', source: 'free' },
  { id: 'i2', section: '内外装工事', name: '下見板張り（防腐剤塗り共）', quantity: 17.6, unit: '㎡', cost: 7800, sale: 12480, manualSale: false, priceOnRequest: false, remark: '', source: 'free' },

  { id: 'o1', section: 'オプション', name: 'ユニットバス1216', quantity: 1, unit: '台', cost: 380000, sale: 608000, manualSale: false, priceOnRequest: false, remark: '', source: 'product' },
  { id: 'o2', section: 'オプション', name: '設備取付関係', quantity: 5, unit: '人', cost: 25000, sale: 25000, manualSale: true, priceOnRequest: false, remark: '手動売価', source: 'free' },

  { id: 's1', section: '別途', name: '運送費', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, remark: '', source: 'free' },
  { id: 's2', section: '別途', name: '基礎工事（設置後工事）', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, remark: '', source: 'free' },
  { id: 's3', section: '別途', name: '給排水給湯設備工事', quantity: 1, unit: '式', cost: 0, sale: 0, manualSale: false, priceOnRequest: true, remark: '敷地状況によって別途見積', source: 'free' },
];

const DEMO_PRODUCTS: DemoProduct[] = [
  { id: 'prod-ub', category: 'ユニットバス', name: 'ユニットバス 1216', manufacturer: 'メーカーA', modelNo: 'UB-1216', price: 608000, priceOnRequest: false },
  { id: 'prod-toilet', category: 'トイレ', name: '節水トイレ', manufacturer: 'メーカーB', modelNo: 'WC-01', price: 240000, priceOnRequest: false },
  { id: 'prod-door', category: '玄関ドア', name: '断熱玄関ドア', manufacturer: 'メーカーC', modelNo: 'DR-100', price: 288000, priceOnRequest: false },
  { id: 'prod-site', category: '別途工事', name: '現場設置工事', manufacturer: '', modelNo: '', price: 0, priceOnRequest: true },
];

const cloneRows = (rows: DemoRow[]) => rows.map((row) => ({ ...row }));
const floorYen = (value: number) => Math.floor(value + 1e-9);
const rowCost = (row: DemoRow) => Math.round(row.quantity * row.cost);
const rowSale = (row: DemoRow) => row.priceOnRequest ? 0 : Math.round(row.quantity * row.sale);
let seq = 0;
const makeId = () => `estimate-demo-${Date.now()}-${++seq}`;

export function EstimateTemplateExcelDemo() {
  const [rows, setRows] = useState<DemoRow[]>(() => cloneRows(INITIAL_ROWS));
  const [savedRows, setSavedRows] = useState<DemoRow[]>(() => cloneRows(INITIAL_ROWS));
  const [collapsed, setCollapsed] = useState<Set<Section>>(() => new Set());
  const [dirty, setDirty] = useState(false);
  const [selectedCell, setSelectedCell] = useState('選択したセルの内容を表示');
  const [markupRate, setMarkupRate] = useState(160);
  const [savedMarkupRate, setSavedMarkupRate] = useState(160);
  const [expenseRate, setExpenseRate] = useState(15);
  const [savedExpenseRate, setSavedExpenseRate] = useState(15);
  const [adjustment, setAdjustment] = useState(-2500);
  const [savedAdjustment, setSavedAdjustment] = useState(-2500);
  const [pickerSection, setPickerSection] = useState<Exclude<Section, '本体'> | null>(null);
  const [replaceRowId, setReplaceRowId] = useState<string | null>(null);
  const [undoRows, setUndoRows] = useState<DemoRow[] | null>(null);
  const [query, setQuery] = useState('');

  const totals = useMemo(() => {
    const cost = rows.reduce((sum, row) => sum + rowCost(row), 0);
    const saleLines = rows.reduce((sum, row) => sum + rowSale(row), 0);
    const expenseBase = rows
      .filter((row) => row.section !== '別途')
      .reduce((sum, row) => sum + rowSale(row), 0);
    const saleExpense = floorYen(expenseBase * expenseRate / 100);
    const subtotal = Math.max(0, saleLines + saleExpense + adjustment);
    const tax = floorYen(subtotal * 0.1);
    const saleGrand = subtotal + tax;
    const profit = saleGrand - cost;
    return {
      cost,
      saleLines,
      saleExpense,
      subtotal,
      tax,
      saleGrand,
      profit,
      margin: saleGrand > 0 ? profit / saleGrand * 100 : 0,
      onRequest: rows.filter((row) => row.priceOnRequest).length,
    };
  }, [rows, expenseRate, adjustment]);

  const sectionTotals = useMemo(() => {
    const map = new Map<Section, { cost: number; sale: number; profit: number; onRequest: number }>();
    for (const section of SECTIONS) {
      const sectionRows = rows.filter((row) => row.section === section);
      const cost = sectionRows.reduce((sum, row) => sum + rowCost(row), 0);
      const sale = sectionRows.reduce((sum, row) => sum + rowSale(row), 0);
      map.set(section, {
        cost,
        sale,
        profit: sale - cost,
        onRequest: sectionRows.filter((row) => row.priceOnRequest).length,
      });
    }
    return map;
  }, [rows]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DEMO_PRODUCTS;
    return DEMO_PRODUCTS.filter((product) =>
      [product.category, product.name, product.manufacturer, product.modelNo].join(' ').toLowerCase().includes(q)
    );
  }, [query]);

  const markDirty = () => setDirty(true);

  const saveLocal = () => {
    setSavedRows(cloneRows(rows));
    setSavedMarkupRate(markupRate);
    setSavedExpenseRate(expenseRate);
    setSavedAdjustment(adjustment);
    setUndoRows(null);
    setDirty(false);
  };

  const resetToSaved = () => {
    if (dirty && !window.confirm('未保存の変更を破棄して、画面内の保存時点へ戻しますか？')) return;
    setRows(cloneRows(savedRows));
    setMarkupRate(savedMarkupRate);
    setExpenseRate(savedExpenseRate);
    setAdjustment(savedAdjustment);
    setCollapsed(new Set());
    setUndoRows(null);
    setPickerSection(null);
    setReplaceRowId(null);
    setQuery('');
    setDirty(false);
  };

  const updateRow = (id: string, patch: Partial<DemoRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    markDirty();
  };

  const toggleSection = (section: Section) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const applyMarkup = () => {
    const autoCount = rows.filter((row) =>
      row.section !== '本体' && row.cost > 0 && !row.manualSale && !row.priceOnRequest
    ).length;
    if (!window.confirm(`自動計算 ${autoCount}件を掛率 ${markupRate.toFixed(2)}% で再計算します。\n本体参照・手動売価・別途見積は変更しません。実行しますか？`)) return;

    setUndoRows(cloneRows(rows));
    setRows((current) => current.map((row) =>
      row.section !== '本体' && row.cost > 0 && !row.manualSale && !row.priceOnRequest
        ? { ...row, sale: floorYen(row.cost * markupRate / 100) }
        : row
    ));
    markDirty();
  };

  const addFreeRow = (section: Exclude<Section, '本体'>) => {
    setRows((current) => [
      ...current,
      {
        id: makeId(),
        section,
        name: '新しい自由項目',
        quantity: 1,
        unit: '式',
        cost: 0,
        sale: 0,
        manualSale: false,
        priceOnRequest: section === '別途',
        remark: '',
        source: 'free',
      },
    ]);
    markDirty();
  };

  const removeRow = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
    markDirty();
  };

  const chooseProduct = (product: DemoProduct) => {
    if (!pickerSection) return;

    const patch: Partial<DemoRow> = {
      name: product.name,
      sale: product.priceOnRequest ? 0 : product.price,
      manualSale: !product.priceOnRequest,
      priceOnRequest: product.priceOnRequest,
      previousSale: null,
      previousManualSale: null,
      manufacturer: product.manufacturer,
      modelNo: product.modelNo,
      remark: product.priceOnRequest
        ? '別途見積'
        : [product.manufacturer, product.modelNo].filter(Boolean).join(' ／ '),
      source: 'product',
    };

    if (replaceRowId) {
      updateRow(replaceRowId, patch);
    } else {
      setRows((current) => [
        ...current,
        {
          id: makeId(),
          section: pickerSection,
          name: product.name,
          quantity: 1,
          unit: product.priceOnRequest ? '式' : '台',
          cost: 0,
          sale: product.priceOnRequest ? 0 : product.price,
          manualSale: !product.priceOnRequest,
          priceOnRequest: product.priceOnRequest,
          previousSale: null,
          previousManualSale: null,
          manufacturer: product.manufacturer,
          modelNo: product.modelNo,
          remark: product.priceOnRequest
            ? '別途見積'
            : [product.manufacturer, product.modelNo].filter(Boolean).join(' ／ '),
          source: 'product',
        },
      ]);
      markDirty();
    }

    setPickerSection(null);
    setReplaceRowId(null);
    setQuery('');
  };

  const toggleSeparate = (row: DemoRow) => {
    if (!row.priceOnRequest) {
      updateRow(row.id, {
        previousSale: row.sale,
        previousManualSale: row.manualSale,
        priceOnRequest: true,
        manualSale: false,
      });
      return;
    }

    const restoreManual = row.previousManualSale === true && row.previousSale != null;
    updateRow(row.id, {
      priceOnRequest: false,
      sale: restoreManual ? row.previousSale ?? 0 : floorYen(row.cost * markupRate / 100),
      manualSale: restoreManual,
      previousSale: null,
      previousManualSale: null,
    });
  };

  const handleCellKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-estimate-demo-cell="1"]'));
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
      const row = Number(current.dataset.row ?? -1);
      const sameColumn = inputs.filter((input) => input.dataset.col === col);
      const next = event.shiftKey
        ? [...sameColumn].reverse().find((input) => Number(input.dataset.row) < row)
        : sameColumn.find((input) => Number(input.dataset.row) > row);
      next?.focus();
      next?.select();
    }
  };

  const cellProps = (column: string, row: number) => ({
    'data-estimate-demo-cell': '1',
    'data-col': column,
    'data-row': row,
    onKeyDown: handleCellKey,
  });

  const inputClass =
    'h-7 w-full border-0 bg-transparent px-1.5 text-[13px] leading-none outline-none focus:ring-2 focus:ring-emerald-700/30';

  let rowCounter = 0;

  return (
    <div className="space-y-4">
      <section className="sticky top-0 z-30 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">見積テンプレート ― Excel操作確認版</h2>
              <span className={dirty
                ? 'rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900'
                : 'rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800'}
              >
                {dirty ? '未保存の変更あり' : '保存時点と同じ'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              本体マスターと同じ列・行高・操作感で確認します。変更は画面内だけで、DBには保存しません。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={resetToSaved}>保存時点に戻す</Button>
            <Button type="button" size="sm" onClick={saveLocal}>画面内でDraft保存</Button>
          </div>
        </div>

        <div className="flex flex-wrap divide-x divide-slate-200 border-b border-slate-200 text-sm">
          <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">商品モデル</span><strong>Wing</strong></div>
          <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">仕様</span><strong>ホテルUB</strong></div>
          <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">防火仕様</span><strong>非防火</strong></div>
          <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">利用地域</span><strong>標準地域</strong></div>
          <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">基準本体</span><strong>Wing ホテル仕様 v4</strong></div>
          <label className="flex items-center gap-2 px-4 py-2">
            <span className="text-xs text-slate-500">売価倍率</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={markupRate}
              onChange={(event) => {
                setMarkupRate(Math.max(0, Number(event.target.value) || 0));
                markDirty();
              }}
              className="h-8 w-24 rounded border border-amber-300 bg-amber-50 px-2 text-right text-sm"
            />
            <span>%</span>
            <button type="button" className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold" onClick={applyMarkup}>
              掛率から売価を再計算
            </button>
            <button
              type="button"
              disabled={!undoRows}
              className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold disabled:opacity-40"
              onClick={() => {
                if (!undoRows) return;
                setRows(cloneRows(undoRows));
                setUndoRows(null);
                markDirty();
              }}
            >
              直前の再計算を元に戻す
            </button>
          </label>
          <label className="flex items-center gap-2 px-4 py-2">
            <span className="text-xs text-slate-500">売価諸費用</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={expenseRate}
              onChange={(event) => {
                setExpenseRate(Math.max(0, Number(event.target.value) || 0));
                markDirty();
              }}
              className="h-8 w-20 rounded border border-amber-300 bg-amber-50 px-2 text-right text-sm"
            />
            <span>%</span>
          </label>
        </div>

        <div className="flex border-b border-slate-200 text-xs">
          <div className="w-16 border-r border-slate-200 bg-slate-100 px-2 py-1.5 font-semibold text-slate-500">内容</div>
          <div className="min-h-7 flex-1 px-3 py-1.5">{selectedCell}</div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs">
          <p>
            <strong className="text-emerald-900">本体マスターから参照中：</strong>
            Wing ホテル仕様 v4
            <span className="ml-2 text-slate-500">本体明細は見積テンプレート側では直接変更しません。</span>
          </p>
          <Link href="/admin/base-masters/demo" className="btn-secondary btn-sm">本体マスターの操作確認画面を開く</Link>
        </div>

        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-[88rem] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 w-12 border-r border-slate-300 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">#</th>
                <th className="sticky top-0 z-10 w-10 border-r border-slate-300 bg-slate-100 px-1 py-1"></th>
                <th className="sticky top-0 z-10 min-w-[20rem] border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">品名</th>
                <th className="sticky top-0 z-10 w-20 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">数量</th>
                <th className="sticky top-0 z-10 w-20 border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">単位</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">原価</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">原価金額</th>
                <th className="sticky top-0 z-10 w-32 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">売価</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">売価金額</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">粗利</th>
                <th className="sticky top-0 z-10 min-w-48 border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">備考</th>
                <th className="sticky top-0 z-10 w-24 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((section) => {
                const sectionRows = rows.filter((row) => row.section === section);
                const isCollapsed = collapsed.has(section);
                const sectionSummary = sectionTotals.get(section)!;
                return (
                  <Fragment key={section}>
                    <tr className="border-b border-slate-300 bg-emerald-900 text-white">
                      <th className="bg-slate-100"></th>
                      <td className="px-1 text-center">
                        <button
                          type="button"
                          className="size-6 rounded border border-white/60 bg-white text-slate-800"
                          aria-label={isCollapsed ? section + 'を展開' : section + 'を折り畳む'}
                          onClick={() => toggleSection(section)}
                        >
                          {isCollapsed ? '+' : '−'}
                        </button>
                      </td>
                      <td colSpan={5} className="px-3 py-1 text-[13px] font-semibold">
                        {section}
                        {section === '本体' && <span className="ml-2 font-normal text-white/75">（本体マスター参照・読取専用）</span>}
                      </td>
                      <td colSpan={4} className="px-3 text-right text-xs">
                        {section === '別途' && sectionSummary.onRequest > 0
                          ? `別途見積 ${sectionSummary.onRequest}件`
                          : `原価 ${formatYen(sectionSummary.cost)} ／ 売価 ${formatYen(sectionSummary.sale)} ／ 粗利 ${formatYen(sectionSummary.profit)}`}
                      </td>
                      <td className="px-2 text-center">
                        {section !== '本体' && (
                          <button
                            type="button"
                            className="text-[11px] underline"
                            onClick={() => {
                              setReplaceRowId(null);
                              setPickerSection(section as Exclude<Section, '本体'>);
                            }}
                          >
                            商品追加
                          </button>
                        )}
                      </td>
                    </tr>

                    {!isCollapsed && sectionRows.map((row) => {
                      rowCounter += 1;
                      const rowIndex = rowCounter;
                      const costAmount = rowCost(row);
                      const saleAmount = rowSale(row);
                      const profit = row.priceOnRequest ? null : saleAmount - costAmount;
                      const readOnly = section === '本体';

                      if (readOnly) {
                        return (
                          <tr key={row.id} className="border-b border-slate-200 bg-slate-100 text-slate-600">
                            <th className="bg-slate-100 px-2 text-center text-xs font-normal text-slate-500">{rowIndex}</th>
                            <td className="border-r border-slate-200"></td>
                            <td className="border-r border-slate-200 px-2">{row.name}</td>
                            <td className="border-r border-slate-200 px-2 text-right">{row.quantity}</td>
                            <td className="border-r border-slate-200 px-2">{row.unit}</td>
                            <td className="border-r border-slate-200 px-3 text-right tabular-nums">{formatYen(row.cost)}</td>
                            <td className="border-r border-slate-200 px-3 text-right tabular-nums">{formatYen(costAmount)}</td>
                            <td className="border-r border-slate-200 px-3 text-right tabular-nums">{formatYen(row.sale)}</td>
                            <td className="border-r border-slate-200 px-3 text-right tabular-nums">{formatYen(saleAmount)}</td>
                            <td className="border-r border-slate-200 px-3 text-right tabular-nums">{formatYen(profit ?? 0)}</td>
                            <td className="border-r border-slate-200 px-2">{row.remark}</td>
                            <td className="px-2 text-center text-xs">参照のみ</td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={row.id} className="border-b border-slate-200 bg-white">
                          <th className="bg-slate-100 px-2 text-center text-xs font-normal text-slate-500">{rowIndex}</th>
                          <td className="border-r border-slate-200"></td>
                          <td
                            title={[row.manufacturer, row.modelNo].filter(Boolean).join(' ／ ') || undefined}
                            className="relative border-r border-slate-200 bg-amber-50 px-0.5"
                          >
                            <div className="pr-7">
                              <input
                                {...cellProps('name', rowIndex)}
                                value={row.name}
                                onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                                onChange={(event) => updateRow(row.id, { name: event.target.value })}
                                className={inputClass}
                              />
                            </div>
                            <button
                              type="button"
                              title="商品を選択・変更"
                              aria-label={row.name + 'の商品を選択・変更'}
                              className="absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded border border-slate-300 bg-white text-[10px] font-bold text-emerald-900"
                              onClick={() => {
                                setReplaceRowId(row.id);
                                setPickerSection(section as Exclude<Section, '本体'>);
                              }}
                            >
                              …
                            </button>
                          </td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            <input
                              {...cellProps('quantity', rowIndex)}
                              type="number"
                              min={0}
                              step={0.01}
                              value={row.quantity}
                              onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                              onChange={(event) => updateRow(row.id, { quantity: Math.max(0, Number(event.target.value) || 0) })}
                              className={inputClass + ' text-right'}
                            />
                          </td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            <input
                              {...cellProps('unit', rowIndex)}
                              value={row.unit}
                              onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                              onChange={(event) => updateRow(row.id, { unit: event.target.value })}
                              className={inputClass}
                            />
                          </td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            <input
                              {...cellProps('cost', rowIndex)}
                              type="number"
                              min={0}
                              step={1}
                              value={row.cost}
                              onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                              onChange={(event) => updateRow(row.id, { cost: Math.max(0, Number(event.target.value) || 0) })}
                              className={inputClass + ' text-right'}
                            />
                          </td>
                          <td className="border-r border-slate-200 bg-slate-50 px-3 text-right tabular-nums">{formatYen(costAmount)}</td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            {row.priceOnRequest ? (
                              <div className="flex h-7 items-center justify-end gap-1 px-1">
                                <span className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">別途見積</span>
                                <button type="button" className="text-[10px] text-emerald-800 underline" onClick={() => toggleSeparate(row)}>金額入力</button>
                              </div>
                            ) : (
                              <div className="flex h-7 items-center gap-1">
                                <input
                                  {...cellProps('sale', rowIndex)}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={row.sale}
                                  onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                                  onChange={(event) => updateRow(row.id, { sale: Math.max(0, Number(event.target.value) || 0), manualSale: true })}
                                  className={inputClass + ' min-w-0 flex-1 text-right'}
                                />
                                <button
                                  type="button"
                                  title={row.manualSale ? 'クリックすると掛率からの自動計算へ戻します' : '掛率から自動計算'}
                                  onClick={() => {
                                    if (!row.manualSale) return;
                                    updateRow(row.id, {
                                      sale: floorYen(row.cost * markupRate / 100),
                                      manualSale: false,
                                    });
                                  }}
                                  className={row.manualSale
                                    ? 'rounded border border-orange-300 bg-orange-50 px-1 text-[10px] font-semibold text-orange-800'
                                    : 'rounded border border-emerald-300 bg-emerald-50 px-1 text-[10px] font-semibold text-emerald-800'}
                                >
                                  {row.manualSale ? '手動' : '自動'}
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="border-r border-slate-200 bg-slate-50 px-3 text-right tabular-nums">{row.priceOnRequest ? '—' : formatYen(saleAmount)}</td>
                          <td className="border-r border-slate-200 bg-slate-50 px-3 text-right tabular-nums">{profit == null ? '—' : formatYen(profit)}</td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            <input
                              {...cellProps('remark', rowIndex)}
                              value={row.remark}
                              onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                              onChange={(event) => updateRow(row.id, { remark: event.target.value })}
                              className={inputClass}
                            />
                          </td>
                          <td className="whitespace-nowrap px-1 text-center">
                            <button
                              type="button"
                              title={row.priceOnRequest ? '金額入力へ戻す' : 'この行を別途見積にする'}
                              className="rounded px-1 text-[10px] text-slate-500 underline"
                              onClick={() => toggleSeparate(row)}
                            >
                              {row.priceOnRequest ? '金額' : '別途'}
                            </button>
                            <button type="button" aria-label="行を削除" title="明細を削除" className="rounded p-1 text-slate-500 hover:text-red-700" onClick={() => removeRow(row.id)}>
                              <Trash2 className="size-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    <tr className="border-y-2 border-emerald-800 bg-emerald-50 font-semibold">
                      <th className="bg-slate-100"></th>
                      <td></td>
                      <td className="px-3 py-1">{section} 計</td>
                      <td className="text-center">{isCollapsed ? '1' : ''}</td><td className="text-center">{isCollapsed ? '式' : ''}</td>
                      <td className="px-3 text-right tabular-nums">{formatYen(sectionSummary.cost)}</td>
                      <td></td>
                      <td className="px-3 text-right tabular-nums">{section === '別途' && sectionSummary.onRequest ? '別途見積' : formatYen(sectionSummary.sale)}</td>
                      <td></td>
                      <td className="px-3 text-right tabular-nums">{section === '別途' && sectionSummary.onRequest ? '—' : formatYen(sectionSummary.profit)}</td>
                      <td></td>
                      <td className="px-2 text-right">
                        {section !== '本体' && (
                          <div className="flex justify-end gap-2">
                            <button type="button" className="text-[11px] text-emerald-800 underline" onClick={() => addFreeRow(section as Exclude<Section, '本体'>)}>
                              ＋自由明細
                            </button>
                            <button
                              type="button"
                              className="text-[11px] text-emerald-800 underline"
                              onClick={() => {
                                setReplaceRowId(null);
                                setPickerSection(section as Exclude<Section, '本体'>);
                              }}
                            >
                              ＋商品
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <p className="text-[11px] text-slate-500">
            黄色＝入力 ／ グレー＝自動計算・参照 ／ Tab＝右 ／ Shift+Tab＝左 ／ Enter＝下 ／ Shift+Enter＝上
          </p>
          <p className="text-[11px] text-slate-500">自動売価＝ROUNDDOWN(原価単価×掛率,0) ／ 粗利＝売価－原価</p>
        </div>
      </section>

      <section className="ml-auto max-w-xl rounded-xl border border-slate-300 bg-white p-5 text-sm shadow-sm">
        <div className="flex justify-between gap-4 py-1"><span>原価合計</span><strong>{formatYen(totals.cost)}</strong></div>
        <div className="flex justify-between gap-4 py-1"><span>売価明細合計</span><strong>{formatYen(totals.saleLines)}</strong></div>
        <div className="flex justify-between gap-4 py-1"><span>売価諸費用 {expenseRate.toFixed(1)}%</span><strong>{formatYen(totals.saleExpense)}</strong></div>
        <label className="flex items-center justify-between gap-4 py-1">
          <span>調整額</span>
          <input
            type="number"
            step={1}
            value={adjustment}
            onChange={(event) => {
              setAdjustment(Number(event.target.value) || 0);
              markDirty();
            }}
            className="h-8 w-32 rounded border border-amber-300 bg-amber-50 px-2 text-right"
          />
        </label>
        <div className="flex justify-between gap-4 py-1"><span>消費税</span><strong>{formatYen(totals.tax)}</strong></div>
        <div className="mt-2 flex justify-between gap-4 border-t-2 border-slate-700 pt-3 text-lg">
          <span>見積金額</span><strong>{formatYen(totals.saleGrand)}</strong>
        </div>
        <div className="mt-2 flex justify-between gap-4 rounded bg-emerald-50 px-3 py-2">
          <span>粗利</span><strong>{formatYen(totals.profit)}</strong>
        </div>
        <div className="flex justify-between gap-4 py-1"><span>粗利率</span><strong>{totals.margin.toFixed(1)}%</strong></div>
        <div className="flex justify-between gap-4 py-1 text-xs text-slate-500"><span>別途見積</span><strong>{totals.onRequest}件</strong></div>
      </section>

      <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Draftの操作</h2>
            <p className="mt-1 text-xs text-slate-500">UI確認版のため、公開・破棄は実行しません。</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled>公開内容を確認</Button>
            <Button type="button" variant="ghost" disabled>Draftを破棄</Button>
          </div>
        </div>
      </section>

      {pickerSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="商品を選択">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{replaceRowId ? '商品を変更' : '商品を追加'}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {replaceRowId ? '選択中の明細を置き換えます' : '新しい明細として追加します'} ／ 追加・変更先：{pickerSection} ／ DB非連動の確認用サンプルです。
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setPickerSection(null);
                  setReplaceRowId(null);
                  setQuery('');
                }}
              >
                閉じる
              </button>
            </div>

            <div className="space-y-4 p-5">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="メーカー・商品名・型番で検索"
                className="h-10 w-full rounded border border-slate-300 px-3 text-sm"
              />

              <div className="grid gap-3 sm:grid-cols-2">
                {filteredProducts.map((product) => (
                  <article key={product.id} className="rounded-xl border border-slate-200 p-4">
                    <p className="text-xs text-slate-500">{product.category} ／ {product.manufacturer || '—'}</p>
                    <h3 className="mt-1 font-semibold">{product.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">{product.modelNo || '型番なし'}</p>
                    <p className="mt-3 text-sm font-semibold">{product.priceOnRequest ? '別途見積' : '追加金額 ' + formatYen(product.price)}</p>
                    <div className="mt-4 flex justify-end">
                      <button type="button" className="btn-primary btn-sm" onClick={() => chooseProduct(product)}>
                        {replaceRowId ? 'この商品に変更' : '追加'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
