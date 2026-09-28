'use client';

import { Fragment, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';
import { estimateDemoSampleById } from '@/components/admin/estimate-template-demo-samples';

type Section = '本体' | '内外装工事' | 'オプション' | '別途';
type DemoTab = 'estimate' | 'plan' | 'drawing';

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

export function EstimateTemplateExcelDemo({ sampleId }: { sampleId?: string | null }) {
  const sample = estimateDemoSampleById(sampleId);
  const [rows, setRows] = useState<DemoRow[]>(() => cloneRows(sample?.rows ?? INITIAL_ROWS));
  const [collapsed, setCollapsed] = useState<Set<Section>>(() => new Set());
  const [dirty, setDirty] = useState(false);
  const [markupRate, setMarkupRate] = useState(160);
  const [expenseRate, setExpenseRate] = useState(sample ? 0 : 15);
  const [adjustment, setAdjustment] = useState(sample?.adjustment ?? -2500);
  const [pickerSection, setPickerSection] = useState<Exclude<Section, '本体'> | null>(null);
  const [pickerTargetRowId, setPickerTargetRowId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<DemoTab>('estimate');
  const [showEstimatePreview, setShowEstimatePreview] = useState(false);

  const totals = useMemo(() => {
    const cost = rows.reduce((sum, row) => sum + rowCost(row), 0);
    const onRequest = rows.filter((row) => row.priceOnRequest).length;

    if (sample && !dirty) {
      const subtotal = sample.sourceSubtotal + sample.adjustment;
      const saleGrand = sample.sourceTotal;
      const profit = saleGrand - cost;
      return {
        cost,
        saleLines: sample.sourceSubtotal,
        saleExpense: 0,
        subtotal,
        tax: sample.tax,
        saleGrand,
        profit,
        margin: saleGrand > 0 ? profit / saleGrand * 100 : 0,
        onRequest,
      };
    }

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
      onRequest,
    };
  }, [rows, expenseRate, adjustment, sample, dirty]);

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

    setRows((current) => current.map((row) =>
      row.section !== '本体' && row.cost > 0 && !row.manualSale && !row.priceOnRequest
        ? { ...row, sale: floorYen(row.cost * markupRate / 100) }
        : row
    ));
    markDirty();
  };

  const addFreeRow = (section: Section) => {
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
        source: section === '本体' ? 'base' : 'free',
      },
    ]);
    markDirty();
  };

  const removeRow = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
    markDirty();
  };

  const openProductPicker = (section: Exclude<Section, '本体'>, targetRowId: string | null = null) => {
    setPickerSection(section);
    setPickerTargetRowId(targetRowId);
    setQuery('');
  };

  const closeProductPicker = () => {
    setPickerSection(null);
    setPickerTargetRowId(null);
    setQuery('');
  };

  const addProduct = (product: DemoProduct) => {
    if (!pickerSection) return;
    if (pickerTargetRowId) {
      setRows((current) => current.map((row) =>
        row.id === pickerTargetRowId
          ? {
              ...row,
              name: product.name,
              unit: product.priceOnRequest ? '式' : '台',
              sale: product.price,
              manualSale: true,
              priceOnRequest: product.priceOnRequest,
              remark: product.priceOnRequest ? '別途見積' : `${product.manufacturer} ${product.modelNo}`.trim(),
              source: 'product',
            }
          : row
      ));
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
          sale: product.price,
          manualSale: true,
          priceOnRequest: product.priceOnRequest,
          remark: product.priceOnRequest ? '別途見積' : `${product.manufacturer} ${product.modelNo}`.trim(),
          source: 'product',
        },
      ]);
    }
    closeProductPicker();
    markDirty();
  };

  const toggleSeparate = (row: DemoRow) => {
    updateRow(row.id, {
      priceOnRequest: !row.priceOnRequest,
      manualSale: row.priceOnRequest ? false : row.manualSale,
      sale: row.priceOnRequest ? floorYen(row.cost * markupRate / 100) : row.sale,
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
    'h-6 w-full min-w-0 border-0 bg-transparent px-1 text-[11px] leading-none outline-none focus:ring-2 focus:ring-emerald-700/30';

  let rowCounter = 0;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="flex items-center gap-1 border-b border-slate-200 px-3" role="tablist" aria-label="見積書作成の表示切替">
          {([
            ['estimate', '見積書'],
            ['plan', 'プランボード'],
            ['drawing', '図面'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`min-h-10 border-b-2 px-4 py-2 text-sm font-semibold transition ${
                tab === key
                  ? 'border-emerald-800 text-emerald-900'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="bg-slate-50 px-4 py-2 text-xs text-slate-600">
          見積書を編集し、同じ内容をプランボード・図面にも反映します。
        </div>
      </section>

      {tab === 'estimate' && (
        <>
      <section className="sticky top-0 z-30 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{sample?.name ?? '見積書作成'}</h2>
              <span className={dirty
                ? 'rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900'
                : sample
                  ? 'rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800'
                  : 'rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700'}
              >
                {dirty ? (sample ? 'サンプル編集中' : '編集中') : (sample ? 'サンプル' : '下書き')}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {sample
                ? `Excel「${sample.sourceSheet}」の金額が入っている明細と別途見積項目を画面確認用に反映しています。0円の未選択候補は除外しています。DBには保存されません。`
                : '本体明細も含めて、この見積書内の明細をExcelのように編集できます。本体マスター自体は変更しません。'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowEstimatePreview((current) => !current)}
            >
              {showEstimatePreview ? 'プレビューを閉じる' : '見積書プレビュー'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled
              title={sample ? 'サンプルはDBへ保存されません' : 'Draft接続後に利用できます'}
            >
              下書き保存
            </Button>
            <Button
              type="button"
              size="sm"
              disabled
              title={sample ? 'サンプルは正式見積として保存されません' : 'Draft→正式Revision接続後に利用できます'}
            >
              正式保存
            </Button>
          </div>
        </div>

        <div className="border-b border-slate-200 text-sm">
          <div className="flex flex-wrap items-stretch border-b border-slate-200">
            <div className="flex w-20 shrink-0 items-center bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              見積条件
            </div>
            <div className="flex flex-wrap divide-x divide-slate-200">
              <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">商品モデル</span><strong>{sample?.model ?? 'Wing'}</strong></div>
              <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">仕様</span><strong>{sample?.spec ?? 'ホテルUB'}</strong></div>
              <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">防火仕様</span><strong>{sample?.fireSpec ?? '非防火'}</strong></div>
              <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">利用地域</span><strong>{sample?.region ?? '標準地域'}</strong></div>
              <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-slate-500">基準本体</span><strong>{sample?.baseMaster ?? 'Wing ホテル仕様 v4'}</strong></div>
            </div>
          </div>

          <div className="flex flex-wrap items-stretch bg-slate-50/50">
            <div className="flex w-20 shrink-0 items-center bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              価格設定
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2">
              <div className="flex items-center gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-700">販売費</p>
                  <p className="text-[10px] text-slate-500">原価側</p>
                </div>
                <div
                  className="flex h-8 min-w-20 items-center justify-end rounded border border-slate-300 bg-slate-100 px-2 text-sm font-semibold text-slate-600"
                  title="原価側の正式計算を接続後に変更できるようにします"
                >
                  100 <span className="ml-1 font-normal">%</span>
                </div>
                <span className="text-[10px] text-slate-400">接続後</span>
              </div>

              <label className="flex items-center gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-700">経費</p>
                  <p className="text-[10px] text-slate-500">{sample ? 'Excel明細に反映済み' : '区分に加算'}</p>
                </div>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={expenseRate}
                  disabled={Boolean(sample)}
                  title={sample ? 'Excel原本の経費行を明細として反映済みです' : undefined}
                  onChange={(event) => {
                    setExpenseRate(Math.max(0, Number(event.target.value) || 0));
                    markDirty();
                  }}
                  className={sample
                    ? 'h-8 w-20 rounded border border-slate-300 bg-slate-100 px-2 text-right text-sm text-slate-500'
                    : 'h-8 w-20 rounded border border-amber-300 bg-amber-50 px-2 text-right text-sm'}
                  aria-label="経費率"
                />
                <span>%</span>
              </label>

              <label className="flex items-center gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-700">掛率</p>
                  <p className="text-[10px] text-slate-500">原価→売価</p>
                </div>
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
                  aria-label="掛率"
                />
                <span>%</span>
              </label>

              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold shadow-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={Boolean(sample)}
                title={sample ? 'Excelサンプルでは原本の売価をそのまま表示します' : undefined}
                onClick={applyMarkup}
              >
                売価を再計算
              </button>
            </div>
          </div>
        </div>

      </section>

      <section className="overflow-visible rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="w-full">
          <table className="w-full table-fixed border-collapse text-[11px]" data-testid="estimate-demo-fit-table">
            <colgroup>
              <col className="w-[3%]" />
              <col className="w-[3%]" />
              <col className="w-[19%]" />
              <col className="w-[5%]" />
              <col className="w-[5%]" />
              <col className="w-[9%]" />
              <col className="w-[11%]" />
              <col className="w-[9%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[5%]" />
            </colgroup>
            <thead>
              <tr>
                <th className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-1 py-1 text-center text-[10px] font-semibold text-slate-600">#</th>
                <th className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-0.5 py-1"></th>
                <th className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-1.5 py-1 text-left text-[10px] font-semibold text-slate-600">品名</th>
                <th className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[10px] font-semibold text-slate-600">数量</th>
                <th className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-1 py-1 text-left text-[10px] font-semibold text-slate-600">単位</th>
                <th className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[10px] font-semibold text-slate-600">原価</th>
                <th className="sticky top-0 z-10 whitespace-nowrap border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[10px] font-semibold text-slate-600">原価金額</th>
                <th className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[10px] font-semibold text-slate-600">売価</th>
                <th className="sticky top-0 z-10 whitespace-nowrap border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[10px] font-semibold text-slate-600">売価金額</th>
                <th className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[10px] font-semibold text-slate-600">粗利</th>
                <th className="sticky top-0 z-10 border-r border-slate-300 bg-slate-100 px-1 py-1 text-left text-[10px] font-semibold text-slate-600">備考</th>
                <th className="sticky top-0 z-10 bg-slate-100 px-0.5 py-1 text-center text-[10px] font-semibold text-slate-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((section) => {
                const sectionRows = rows.filter((row) => row.section === section);
                const isCollapsed = collapsed.has(section);
                const sectionSummary = sectionTotals.get(section)!;
                return (
                  <Fragment key={section}>
                    {!isCollapsed && (
                      <tr className="border-b border-slate-300 bg-emerald-900 text-white">
                        <th className="bg-slate-100"></th>
                        <td className="px-1 text-center">
                          <button
                            type="button"
                            className="size-6 rounded border border-white/60 bg-white text-slate-800"
                            aria-label={section + 'を折り畳む'}
                            onClick={() => toggleSection(section)}
                          >
                            −
                          </button>
                        </td>
                        <td colSpan={5} className="px-3 py-1 text-[13px] font-semibold">
                          {section}
                          {section === '本体' && <span className="ml-2 font-normal text-white/75">（本体マスターから読込・この見積内で編集可）</span>}
                        </td>
                        <td colSpan={4} className="whitespace-nowrap px-1 text-right text-[10px]">
                          {section === '別途' && sectionSummary.onRequest > 0
                            ? `別途見積 ${sectionSummary.onRequest}件`
                            : `売価 ${formatYen(sectionSummary.sale)}`}
                        </td>
                        <td className="px-2 text-center">
                          {section !== '本体' && (
                            <button
                              type="button"
                              className="text-[11px] underline"
                              onClick={() => openProductPicker(section as Exclude<Section, '本体'>)}
                            >
                              商品追加
                            </button>
                          )}
                        </td>
                      </tr>
                    )}

                    {!isCollapsed && sectionRows.map((row) => {
                      rowCounter += 1;
                      const rowIndex = rowCounter;
                      const costAmount = rowCost(row);
                      const saleAmount = rowSale(row);
                      const profit = row.priceOnRequest ? null : saleAmount - costAmount;

                      return (
                        <tr key={row.id} className="border-b border-slate-200 bg-white">
                          <th className="bg-slate-100 px-0.5 text-center text-[10px] font-normal text-slate-500">{rowIndex}</th>
                          <td className="border-r border-slate-200"></td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            <input
                              {...cellProps('name', rowIndex)}
                              value={row.name}
                              onChange={(event) => updateRow(row.id, { name: event.target.value })}
                              className={inputClass}
                            />
                          </td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            <input
                              {...cellProps('quantity', rowIndex)}
                              type="number"
                              min={0}
                              step={0.01}
                              value={row.quantity}
                              onChange={(event) => updateRow(row.id, { quantity: Math.max(0, Number(event.target.value) || 0) })}
                              className={inputClass + ' appearance-none text-right tabular-nums'}
                            />
                          </td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            <input
                              {...cellProps('unit', rowIndex)}
                              value={row.unit}
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
                              onChange={(event) => updateRow(row.id, { cost: Math.max(0, Number(event.target.value) || 0) })}
                              className={inputClass + ' appearance-none text-right tabular-nums'}
                            />
                          </td>
                          <td className="whitespace-nowrap border-r border-slate-200 bg-slate-50 px-1 text-right text-[10px] tabular-nums">{formatYen(costAmount)}</td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            {row.priceOnRequest ? (
                              <div className="flex h-6 items-center justify-end px-0.5">
                                <span className="whitespace-nowrap rounded border border-amber-400 bg-amber-50 px-1 py-0.5 text-[9px] font-semibold text-amber-900">別途見積</span>
                              </div>
                            ) : (
                              <div className="flex h-6 min-w-0 items-center gap-0.5">
                                <input
                                  {...cellProps('sale', rowIndex)}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={row.sale}
                                  onChange={(event) => updateRow(row.id, { sale: Math.max(0, Number(event.target.value) || 0), manualSale: true })}
                                  className={inputClass + ' min-w-0 flex-1 appearance-none px-0.5 text-right text-[10px] tabular-nums'}
                                />
                                <span className={row.manualSale
                                  ? 'shrink-0 rounded border border-orange-300 bg-orange-50 px-0.5 text-[8px] font-semibold text-orange-800'
                                  : 'shrink-0 rounded border border-emerald-300 bg-emerald-50 px-0.5 text-[8px] font-semibold text-emerald-800'}
                                >
                                  {row.manualSale ? '手動' : '自動'}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap border-r border-slate-200 bg-slate-50 px-1 text-right text-[10px] tabular-nums">{row.priceOnRequest ? '—' : formatYen(saleAmount)}</td>
                          <td className="whitespace-nowrap border-r border-slate-200 bg-slate-50 px-1 text-right text-[10px] tabular-nums">{profit == null ? '—' : formatYen(profit)}</td>
                          <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                            <input
                              {...cellProps('remark', rowIndex)}
                              value={row.remark}
                              onChange={(event) => updateRow(row.id, { remark: event.target.value })}
                              className={inputClass}
                              title={row.remark || undefined}
                            />
                          </td>
                          <td className="relative px-0.5 text-center">
                            <details className="group relative inline-block" data-testid={`estimate-demo-row-menu-${row.id}`}>
                              <summary
                                className="flex size-6 cursor-pointer list-none items-center justify-center rounded text-sm font-bold text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
                                aria-label={row.name + 'の操作'}
                                title="行の操作"
                              >
                                ⋯
                              </summary>
                              <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left text-[11px] font-normal shadow-lg">
                                {section !== '本体' && (
                                  <button
                                    type="button"
                                    className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                                    onClick={(event) => {
                                      event.currentTarget.closest('details')?.removeAttribute('open');
                                      openProductPicker(section as Exclude<Section, '本体'>, row.id);
                                    }}
                                  >
                                    既存の商品から選択
                                  </button>
                                )}
                                {section !== '本体' && (
                                  <button
                                    type="button"
                                    className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                                    onClick={(event) => {
                                      event.currentTarget.closest('details')?.removeAttribute('open');
                                      toggleSeparate(row);
                                    }}
                                  >
                                    {row.priceOnRequest ? '金額入力に戻す' : '別途見積にする'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-red-700 hover:bg-red-50"
                                  onClick={(event) => {
                                    event.currentTarget.closest('details')?.removeAttribute('open');
                                    removeRow(row.id);
                                  }}
                                >
                                  行を削除
                                </button>
                              </div>
                            </details>
                          </td>
                        </tr>
                      );
                    })}

                    <tr
                      className={`border-y-2 border-emerald-800 bg-emerald-50 font-semibold ${isCollapsed ? 'cursor-pointer hover:bg-emerald-100/70' : ''}`}
                      data-testid={`estimate-demo-section-total-${section}`}
                      onClick={isCollapsed ? () => toggleSection(section) : undefined}
                    >
                      <th className="bg-slate-100"></th>
                      <td className="px-1 text-center">
                        {isCollapsed && (
                          <button
                            type="button"
                            className="size-6 rounded border border-emerald-300 bg-white text-slate-800"
                            aria-label={section + 'を展開'}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSection(section);
                            }}
                          >
                            +
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-1">{section} 計</td>
                      <td></td><td></td>
                      <td className="whitespace-nowrap px-1 text-right text-[10px] tabular-nums">{formatYen(sectionSummary.cost)}</td>
                      <td></td>
                      <td className="whitespace-nowrap px-1 text-right text-[10px] tabular-nums">{section === '別途' && sectionSummary.onRequest ? '別途見積' : formatYen(sectionSummary.sale)}</td>
                      <td></td>
                      <td className="whitespace-nowrap px-1 text-right text-[10px] tabular-nums">{section === '別途' && sectionSummary.onRequest ? '—' : formatYen(sectionSummary.profit)}</td>
                      <td></td>
                      <td className="px-0.5 text-center">
                        {!isCollapsed && (
                          <button
                            type="button"
                            className="rounded px-1 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100"
                            title="自由明細を追加"
                            aria-label={section + 'に自由明細を追加'}
                            onClick={() => addFreeRow(section)}
                          >
                            ＋
                          </button>
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
        <div className="flex justify-between gap-4 py-1">
          <span>{sample ? '追加経費（Excel明細に反映済み）' : `経費 ${expenseRate.toFixed(1)}%`}</span>
          <strong>{sample ? '—' : formatYen(totals.saleExpense)}</strong>
        </div>
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
        {sample && (
          <div className="flex justify-between gap-4 py-1 text-xs text-slate-500">
            <span>Excel原本 税込合計</span><strong>{formatYen(sample.sourceTotal)}</strong>
          </div>
        )}
        <div className="mt-2 flex justify-between gap-4 rounded bg-emerald-50 px-3 py-2">
          <span>粗利</span><strong>{formatYen(totals.profit)}</strong>
        </div>
        <div className="flex justify-between gap-4 py-1"><span>粗利率</span><strong>{totals.margin.toFixed(1)}%</strong></div>
        <div className="flex justify-between gap-4 py-1 text-xs text-slate-500"><span>別途見積</span><strong>{totals.onRequest}件</strong></div>
      </section>

        </>
      )}

      {tab === 'estimate' && showEstimatePreview && (
        <section data-testid="estimate-live-preview" className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <p className="text-xs text-slate-500">見積書プレビュー・画面内編集と連動</p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">御見積書</h2>
                <p className="mt-1 text-sm text-slate-600">{sample ? `${sample.model} ${sample.spec}／${sample.fireSpec}` : 'Wing ホテルUB／非防火'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">見積金額（税込）</p>
                <p className="text-2xl font-bold">{formatYen(totals.saleGrand)}</p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto p-5">
            <table className="min-w-[48rem] w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-slate-300 bg-slate-50 text-xs text-slate-600">
                  <th className="px-3 py-2 text-left">品名</th>
                  <th className="px-3 py-2 text-right">数量</th>
                  <th className="px-3 py-2 text-left">単位</th>
                  <th className="px-3 py-2 text-right">単価</th>
                  <th className="px-3 py-2 text-right">金額</th>
                  <th className="px-3 py-2 text-left">備考</th>
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((section) => (
                  <Fragment key={section}>
                    <tr className="border-b border-slate-300 bg-emerald-50">
                      <td colSpan={6} className="px-3 py-1.5 font-semibold text-emerald-950">{section}</td>
                    </tr>
                    {rows.filter((row) => row.section === section).map((row) => (
                      <tr key={row.id} className="border-b border-slate-200">
                        <td className="px-3 py-2">{row.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
                        <td className="px-3 py-2">{row.unit}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.priceOnRequest ? '別途見積' : formatYen(row.sale)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.priceOnRequest ? '—' : formatYen(rowSale(row))}</td>
                        <td className="px-3 py-2 text-slate-600">{row.remark}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ml-auto max-w-md space-y-1 border-t border-slate-200 px-6 py-5 text-sm">
            <div className="flex justify-between gap-4"><span>明細・諸費用・調整後</span><strong>{formatYen(totals.subtotal)}</strong></div>
            <div className="flex justify-between gap-4"><span>消費税</span><strong>{formatYen(totals.tax)}</strong></div>
            <div className="flex justify-between gap-4 border-t border-slate-400 pt-2 text-lg"><span>税込合計</span><strong>{formatYen(totals.saleGrand)}</strong></div>
          </div>
        </section>
      )}

      {tab === 'plan' && (
        <section data-testid="plan-live-preview" className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs text-slate-500">プランボード・画面内編集と連動</p>
              <h2 className="mt-1 text-xl font-semibold">{sample ? `${sample.model} ${sample.spec} プラン` : 'Wing ホテルUB プラン'}</h2>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">現在の見積金額</p>
              <p className="text-xl font-bold">{formatYen(totals.saleGrand)}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {SECTIONS.map((section) => (
              <article key={section} className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold">{section}</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {rows.filter((row) => row.section === section).map((row) => (
                    <div key={row.id} className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
                      <div>
                        <p className="font-medium">{row.name}</p>
                        <p className="text-xs text-slate-500">{row.quantity}{row.unit}{row.remark ? ' ／ ' + row.remark : ''}</p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold">{row.priceOnRequest ? '別途見積' : formatYen(rowSale(row))}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === 'drawing' && (
        <section data-testid="drawing-workspace-preview" className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs text-slate-500">図面も同じ見積書作成ワークスペースで管理</p>
              <h2 className="mt-1 text-xl font-semibold">図面</h2>
              <p className="mt-2 text-sm text-slate-600">見積書・プランボードと同じ案件内容を参照し、図面を作成・確認する位置づけです。</p>
            </div>
            <Button type="button" disabled>図面を追加（接続後）</Button>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {[
              ['平面図', '1階・2階の間取り、寸法、設備位置'],
              ['立面図', '外観・開口・屋根形状'],
              ['配置図', '設置位置、敷地・道路との関係'],
            ].map(([title, body]) => (
              <article key={title} className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
                <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-400">
                  {title}プレビュー
                </div>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">{body}</p>
                <button type="button" disabled className="mt-3 text-xs font-semibold text-slate-400">作成・差し替え（接続後）</button>
              </article>
            ))}
          </div>
          <p className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            現在は配置確認だけです。図面ファイル保存・作図機能・Revisionとの正式な紐付けは後続工程で接続します。
          </p>
        </section>
      )}

      {pickerSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="既存の商品から選択">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{pickerTargetRowId ? '既存の商品から選択' : '商品を追加'}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {pickerTargetRowId
                    ? `選択した商品を現在の明細行へ反映します。区分：${pickerSection}`
                    : `追加先：${pickerSection} ／ この一覧もDB非連動の確認用サンプルです。`}
                </p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={closeProductPicker}>閉じる</button>
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
                      <button type="button" className="btn-primary btn-sm" onClick={() => addProduct(product)}>
                        {pickerTargetRowId ? 'この商品を選ぶ' : '追加'}
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
