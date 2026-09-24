'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState, type KeyboardEvent } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

type SectionCode = 'interior_exterior' | 'option' | 'sitework';

export interface EstimateTemplateWorkbenchLine {
  id: string;
  section: SectionCode;
  groupLabel: string;
  name: string;
  quantity: number;
  unit: string;
  saleUnitPrice: number;
  remark: string;
  source: 'legacy' | 'product' | 'free';
  customerSelection: string;
}

export interface EstimateTemplateWorkbenchProduct {
  id: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  name: string;
  manufacturer: string;
  modelNo: string;
  sizeNote: string;
  price: number;
  priceOnRequest: boolean;
  imageUrl: string | null;
}

export interface EstimateTemplateWorkbenchSection {
  code: SectionCode;
  label: string;
  expenseLabel: string | null;
  expenseAmount: number;
}

type CollapsibleSection = 'base' | SectionCode;

const SECTION_PRODUCT_CATEGORY_CODES: Record<SectionCode, readonly string[]> = {
  interior_exterior: [
    'roof',
    'exterior-wall',
    'floor',
    'wall-ceiling',
    'entrance-door',
    'sash',
    'interior-door',
    'carpentry',
    'fireproof',
    'insulation',
  ],
  option: [
    'ub',
    'kitchen',
    'washbasin',
    'toilet',
    'boiler',
    'aircon',
    'lighting',
    'furniture',
    'appliances',
    'smartlock',
    'exterior-parts',
    'office-supplies',
  ],
  sitework: ['sitework', 'free-product'],
};

export function EstimateTemplateWorkbench({
  templateId,
  role,
  baseLines,
  baseTotal,
  initialLines,
  sections,
  products,
  createdOptionId,
  returnSection,
  taxRate,
  adjustment,
  demoMode = false,
}: {
  templateId: string;
  role: 'admin' | 'master_dealer' | 'dealer' | 'customer';
  baseLines: Array<{
    id: string;
    section: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    amount: number;
    remark: string;
  }>;
  baseTotal: number;
  initialLines: EstimateTemplateWorkbenchLine[];
  sections: EstimateTemplateWorkbenchSection[];
  products: EstimateTemplateWorkbenchProduct[];
  createdOptionId?: string;
  returnSection?: SectionCode;
  taxRate: number;
  adjustment: number;
  demoMode?: boolean;
}) {
  const createdProduct = createdOptionId ? products.find((product) => product.id === createdOptionId) : null;
  const createdProductSection = createdProduct
    ? (
        returnSection && SECTION_PRODUCT_CATEGORY_CODES[returnSection].includes(createdProduct.categoryCode)
          ? returnSection
          : (Object.entries(SECTION_PRODUCT_CATEGORY_CODES).find(([, codes]) => codes.includes(createdProduct.categoryCode))?.[0] as SectionCode | undefined)
            ?? returnSection
            ?? 'option'
      )
    : null;
  const [rows, setRows] = useState<EstimateTemplateWorkbenchLine[]>(() => {
    const base = [...initialLines];
    if (!createdProduct || !createdProductSection) return base;
    const section = createdProductSection;
    if (base.some((row) => row.source === 'product' && row.id === createdProduct.id)) return base;
    return [
      ...base,
      {
        id: createdProduct.id,
        section,
        groupLabel: createdProduct.categoryName,
        name: createdProduct.name,
        quantity: 1,
        unit: '式',
        saleUnitPrice: createdProduct.priceOnRequest ? 0 : createdProduct.price,
        remark: createdProduct.priceOnRequest ? '別途見積' : '',
        source: 'product',
        customerSelection: '標準・変更可',
      },
    ];
  });
  const [showCost, setShowCost] = useState(false);
  const [pickerSection, setPickerSection] = useState<SectionCode | null>(null);
  const [pickerTargetRowId, setPickerTargetRowId] = useState<string | null>(null);
  const [pickerCategory, setPickerCategory] = useState('');
  const [pickerQuery, setPickerQuery] = useState('');
  const [isDirty, setIsDirty] = useState(Boolean(createdProduct));
  const [salesExpenseRate, setSalesExpenseRate] = useState(100);
  const [expenseRate, setExpenseRate] = useState(15);
  const [markupRate, setMarkupRate] = useState(150);
  const [localAdjustment, setLocalAdjustment] = useState(adjustment);
  const [collapsedSections, setCollapsedSections] = useState<Set<CollapsibleSection>>(() => new Set());
  const rateSettingsDirty =
    salesExpenseRate !== 100 ||
    expenseRate !== 15 ||
    markupRate !== 150 ||
    localAdjustment !== adjustment;
  const hasLocalChanges = isDirty || rateSettingsDirty;

  const totals = useMemo(() => {
    const result: Record<SectionCode, number> = {
      interior_exterior: 0,
      option: 0,
      sitework: 0,
    };
    for (const row of rows) {
      result[row.section] += Math.round(row.quantity * row.saleUnitPrice);
    }
    for (const section of sections) result[section.code] += section.expenseAmount;
    return result;
  }, [rows, sections]);

  const subtotalRaw = baseTotal + totals.interior_exterior + totals.option + totals.sitework;
  const subtotal = Math.max(0, subtotalRaw + localAdjustment);
  const tax = Math.floor(subtotal * taxRate);
  const total = subtotal + tax;

  const pickerCategories = useMemo(() => {
    if (!pickerSection) return [];
    const allowedCodes = new Set(SECTION_PRODUCT_CATEGORY_CODES[pickerSection]);
    const map = new Map<string, string>();
    for (const product of products) {
      if (!allowedCodes.has(product.categoryCode)) continue;
      map.set(product.categoryId, product.categoryName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [pickerSection, products]);

  const pickerProducts = useMemo(() => {
    if (!pickerSection) return [];
    const allowedCodes = new Set(SECTION_PRODUCT_CATEGORY_CODES[pickerSection]);
    const query = pickerQuery.trim().toLowerCase();
    return products.filter((product) => {
      if (!allowedCodes.has(product.categoryCode)) return false;
      if (pickerCategory && product.categoryId !== pickerCategory) return false;
      if (!query) return true;
      return [
        product.name,
        product.manufacturer,
        product.modelNo,
        product.sizeNote,
        product.categoryName,
      ].join(' ').toLowerCase().includes(query);
    });
  }, [pickerSection, products, pickerCategory, pickerQuery]);

  const pickerSectionLabel = pickerSection
    ? sections.find((section) => section.code === pickerSection)?.label ?? pickerSection
    : '';
  const pickerCategoryName = pickerCategory
    ? pickerCategories.find(([id]) => id === pickerCategory)?.[1] ?? ''
    : '';

  const visibleColumnCount = showCost ? 13 : 10;
  const grandLabelSpan = showCost ? 8 : 6;
  const grandTailSpan = showCost ? 4 : 3;

  const rowNumberByKey = useMemo(() => {
    const map = new Map<string, number>();
    let number = 0;
    for (const line of baseLines) map.set('base:' + line.id, ++number);
    for (const section of sections) {
      for (const row of rows) {
        if (row.section === section.code) map.set('row:' + row.id, ++number);
      }
    }
    return map;
  }, [baseLines, rows, sections]);

  const resetRows = () => {
    setRows([...initialLines]);
    setPickerSection(null);
    setPickerTargetRowId(null);
    setPickerCategory('');
    setPickerQuery('');
    setCollapsedSections(new Set());
    setSalesExpenseRate(100);
    setExpenseRate(15);
    setMarkupRate(150);
    setLocalAdjustment(adjustment);
    setIsDirty(false);
  };

  const toggleSection = (section: CollapsibleSection) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const handleGridKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.key !== 'Enter') return;
    const col = event.currentTarget.dataset.estimateGridCol;
    if (!col) return;

    event.preventDefault();
    const cells = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[data-estimate-grid-col="${col}"]`)
    ).filter((element) => !element.disabled && element.offsetParent !== null);
    const index = cells.indexOf(event.currentTarget);
    const target = cells[event.shiftKey ? index - 1 : index + 1];
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement) target.select();
  };

  const updateRow = (id: string, patch: Partial<EstimateTemplateWorkbenchLine>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setIsDirty(true);
  };

  const openProductPicker = (section: SectionCode, rowId: string | null = null) => {
    const target = rowId ? rows.find((row) => row.id === rowId) : null;
    const allowedCodes = new Set(SECTION_PRODUCT_CATEGORY_CODES[section]);
    const currentCategoryId = target
      ? products.find(
          (product) => product.categoryName === target.groupLabel && allowedCodes.has(product.categoryCode)
        )?.categoryId ?? ''
      : '';
    setPickerSection(section);
    setPickerTargetRowId(rowId);
    setPickerCategory(currentCategoryId);
    setPickerQuery('');
  };

  const closeProductPicker = () => {
    setPickerSection(null);
    setPickerTargetRowId(null);
    setPickerCategory('');
    setPickerQuery('');
  };

  const addProduct = (product: EstimateTemplateWorkbenchProduct) => {
    if (!pickerSection) return;

    if (pickerTargetRowId) {
      setRows((current) =>
        current.map((row) =>
          row.id === pickerTargetRowId
            ? {
                ...row,
                groupLabel: product.categoryName,
                name: product.name,
                unit: row.unit || '式',
                saleUnitPrice: product.priceOnRequest ? 0 : product.price,
                remark: product.priceOnRequest
                  ? '別途見積'
                  : [product.manufacturer, product.modelNo].filter(Boolean).join(' ／ '),
                source: 'product',
                customerSelection:
                  row.customerSelection === '—' ? '標準・変更可' : row.customerSelection,
              }
            : row
        )
      );
    } else {
      setRows((current) => [
        ...current,
        {
          id: 'product-' + product.id + '-' + Date.now(),
          section: pickerSection,
          groupLabel: product.categoryName,
          name: product.name,
          quantity: 1,
          unit: '式',
          saleUnitPrice: product.priceOnRequest ? 0 : product.price,
          remark: product.priceOnRequest
            ? '別途見積'
            : [product.manufacturer, product.modelNo].filter(Boolean).join(' ／ '),
          source: 'product',
          customerSelection: '標準・変更可',
        },
      ]);
    }

    setIsDirty(true);
    closeProductPicker();
  };

  const addFreeLine = (section: SectionCode) => {
    setRows((current) => [
      ...current,
      {
        id: 'free-' + Date.now(),
        section,
        groupLabel: '',
        name: '新しい自由項目',
        quantity: 1,
        unit: '式',
        saleUnitPrice: 0,
        remark: '',
        source: 'free',
        customerSelection: '—',
      },
    ]);
    setIsDirty(true);
  };

  const removeRow = (id: string) => {
    setRows((current) => current.filter((item) => item.id !== id));
    setIsDirty(true);
  };

  const editableRow = (row: EstimateTemplateWorkbenchLine) => {
    const displayRowNumber = rowNumberByKey.get('row:' + row.id) ?? 0;
    const amount = Math.round(row.quantity * row.saleUnitPrice);
    return (
      <tr key={row.id} className="border-b border-slate-200 bg-white">
        <th className="sticky left-0 z-10 w-11 border-r border-slate-200 bg-slate-100 px-2 text-center text-xs font-normal text-slate-500">
          {displayRowNumber}
        </th>
        <td className="sticky left-[2.75rem] z-10 w-9 border-r border-slate-200 bg-white"></td>
        <td className="sticky left-[5rem] z-10 min-w-[20rem] border-r border-slate-200 bg-amber-50 px-0.5">
          <div className="flex items-center gap-0.5">
            <Input
              value={row.name}
              data-estimate-grid-col="name"
              onKeyDown={handleGridKeyDown}
              onDoubleClick={() => openProductPicker(row.section, row.id)}
              onChange={(event) => updateRow(row.id, { name: event.target.value })}
              className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1.5 text-xs shadow-none focus:ring-2 focus:ring-emerald-700/30"
            />
            <button
              type="button"
              title="商品マスターから選び直す"
              aria-label={row.name + 'の商品を変更'}
              className="flex size-6 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-xs font-bold text-slate-600 hover:border-emerald-700 hover:text-emerald-800"
              onClick={() => openProductPicker(row.section, row.id)}
            >
              …
            </button>
          </div>
        </td>
        <td className="w-16 border-r border-slate-200 bg-amber-50 px-0.5">
          <Input
            type="number"
            min={0.0001}
            step={0.1}
            value={row.quantity}
            data-estimate-grid-col="quantity"
            onKeyDown={handleGridKeyDown}
            onChange={(event) => updateRow(row.id, { quantity: Number(event.target.value) })}
            className="h-7 w-full border-0 bg-transparent px-1 text-right text-xs shadow-none focus:ring-2 focus:ring-emerald-700/30"
          />
        </td>
        <td className="w-16 border-r border-slate-200 bg-amber-50 px-0.5">
          <Input
            value={row.unit}
            data-estimate-grid-col="unit"
            onKeyDown={handleGridKeyDown}
            onChange={(event) => updateRow(row.id, { unit: event.target.value })}
            className="h-7 w-full border-0 bg-transparent px-1 text-xs shadow-none focus:ring-2 focus:ring-emerald-700/30"
          />
        </td>
        {showCost && (
          <>
            <td className="w-28 border-r border-slate-200 bg-slate-50 px-3 text-right text-slate-400">—</td>
            <td className="w-28 border-r border-slate-200 bg-slate-50 px-3 text-right text-slate-400">—</td>
          </>
        )}
        <td className="w-28 border-r border-slate-200 bg-amber-50 px-0.5">
          <Input
            type="number"
            min={0}
            step={1}
            value={row.saleUnitPrice}
            data-estimate-grid-col="sale"
            onKeyDown={handleGridKeyDown}
            onChange={(event) => updateRow(row.id, { saleUnitPrice: Number(event.target.value) })}
            className="h-7 w-full border-0 bg-transparent px-1 text-right text-xs shadow-none focus:ring-2 focus:ring-emerald-700/30"
          />
        </td>
        <td className="w-24 border-r border-slate-200 bg-slate-50 px-2 text-right text-xs font-semibold tabular-nums">
          {formatYen(amount)}
        </td>
        {showCost && (
          <td className="w-28 border-r border-slate-200 bg-slate-50 px-3 text-right text-slate-400">—</td>
        )}
        <td className="min-w-48 border-r border-slate-200 bg-amber-50 px-0.5">
          <Input
            value={row.remark}
            data-estimate-grid-col="remark"
            onKeyDown={handleGridKeyDown}
            onChange={(event) => updateRow(row.id, { remark: event.target.value })}
            className="h-7 w-full border-0 bg-transparent px-1 text-xs shadow-none focus:ring-2 focus:ring-emerald-700/30"
          />
        </td>
        <td className="w-40 border-r border-slate-200 bg-amber-50 px-1">
          {row.source === 'product' ? (
            <Select
              value={row.customerSelection}
              data-estimate-grid-col="selection"
              onKeyDown={handleGridKeyDown}
              onChange={(event) => updateRow(row.id, { customerSelection: event.target.value })}
              className="h-7 min-h-7 w-full border-0 bg-transparent px-1 text-[11px] shadow-none"
            >
              <option>標準・変更可</option>
              <option>標準・固定</option>
              <option>任意オプション</option>
              <option>お客様には表示しない</option>
            </Select>
          ) : (
            <span className="px-2 text-xs text-slate-400">—</span>
          )}
        </td>
        <td className="w-16 px-1 text-center">
          <button
            type="button"
            className="text-[11px] text-red-700 underline underline-offset-2"
            onClick={() => removeRow(row.id)}
          >
            削除
          </button>
        </td>
      </tr>
    );
  };

  const baseRow = (line: (typeof baseLines)[number]) => {
    const displayRowNumber = rowNumberByKey.get('base:' + line.id) ?? 0;
    return (
      <tr key={line.id} className="border-b border-slate-200 bg-slate-100 text-slate-600">
        <th className="sticky left-0 z-10 w-11 border-r border-slate-200 bg-slate-100 px-2 text-center text-xs font-normal text-slate-500">
          {displayRowNumber}
        </th>
        <td className="sticky left-[2.75rem] z-10 w-9 border-r border-slate-200 bg-slate-100"></td>
        <td className="sticky left-[5rem] z-10 min-w-[20rem] border-r border-slate-200 bg-slate-100 px-2 py-1">
          <div className="truncate text-xs font-medium" title={line.name}>{line.name}</div>
        </td>
        <td className="w-16 border-r border-slate-200 px-2 text-right text-xs">{line.quantity}</td>
        <td className="w-16 border-r border-slate-200 px-2 text-xs">{line.unit}</td>
        {showCost && (
          <>
            <td className="w-28 border-r border-slate-200 px-3 text-right text-slate-400">—</td>
            <td className="w-28 border-r border-slate-200 px-3 text-right text-slate-400">—</td>
          </>
        )}
        <td className="w-28 border-r border-slate-200 px-2 text-right text-xs tabular-nums">{formatYen(line.unitPrice)}</td>
        <td className="w-24 border-r border-slate-200 px-2 text-right text-xs font-semibold tabular-nums">{formatYen(line.amount)}</td>
        {showCost && <td className="w-28 border-r border-slate-200 px-3 text-right text-slate-400">—</td>}
        <td className="min-w-48 border-r border-slate-200 px-2 text-xs">{line.remark}</td>
        <td className="w-40 border-r border-slate-200 px-2 text-xs text-slate-400">—</td>
        <td className="w-16 px-1 text-center text-[10px] text-slate-500">参照</td>
      </tr>
    );
  };

  const sectionHeader = ({
    key,
    label,
    totalAmount,
    rowCount,
    expenseText,
    editable,
  }: {
    key: CollapsibleSection;
    label: string;
    totalAmount: number;
    rowCount: number;
    expenseText?: string;
    editable: boolean;
  }) => {
    const collapsed = collapsedSections.has(key);
    return (
      <tr key={'section-' + key} className="border-b border-emerald-950 bg-emerald-900 text-white">
        <th className="sticky left-0 z-20 w-11 bg-slate-100"></th>
        <td className="sticky left-[2.75rem] z-20 w-9 border-r border-emerald-800 bg-emerald-900 px-1 text-center">
          <button
            type="button"
            className="my-0.5 flex size-5 items-center justify-center rounded border border-white/60 bg-white text-xs font-bold text-slate-800"
            aria-expanded={!collapsed}
            aria-label={collapsed ? label + 'の明細を開く' : label + 'の明細を閉じる'}
            onClick={() => toggleSection(key)}
          >
            {collapsed ? '+' : '−'}
          </button>
        </td>
        <td className="sticky left-[5rem] z-20 min-w-[20rem] border-r border-emerald-800 bg-emerald-900 px-2 py-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <strong className="text-xs">{label}</strong>
            <span className="text-[11px] text-white/75">{rowCount}行</span>
            {editable && !collapsed && (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-[11px] font-semibold underline underline-offset-2"
                  onClick={() => openProductPicker(key as SectionCode)}
                >
                  ＋商品
                </button>
                <button
                  type="button"
                  className="text-[11px] font-semibold underline underline-offset-2"
                  onClick={() => addFreeLine(key as SectionCode)}
                >
                  ＋自由明細
                </button>
              </span>
            )}
          </div>
        </td>
        <td colSpan={visibleColumnCount - 3} className="bg-emerald-900 px-2 py-1">
          <div className="flex items-center justify-end gap-3">
            {expenseText && <span className="text-[11px] text-white/75">{expenseText}</span>}
            <span className="text-xs font-semibold">{formatYen(totalAmount)}</span>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      {createdProduct && (
        <div className="rounded-lg border border-forest/30 bg-forest/5 px-4 py-3 text-sm">
          「{createdProduct.name}」を商品登録し、標準見積へ戻りました。
          画面確認用として「{createdProductSection === 'interior_exterior' ? '内外装工事' : createdProductSection === 'sitework' ? '別途' : 'オプション'}」へ追加しています。
        </div>
      )}

      <section
        className="sticky top-0 z-30 overflow-hidden rounded-lg border border-slate-300 bg-white/95 shadow-sm backdrop-blur"
        data-testid="estimate-workbench-sticky-summary"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <div className="mr-2">
            <p className="text-sm font-semibold">標準見積編集 ― Excel形式</p>
            <p className="text-[11px] text-slate-500">明細を1枚の表で連続編集します。シミュレーター見積書のレイアウトは使用しません。</p>
          </div>
          <span
            className={
              hasLocalChanges
                ? 'rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[0.68rem] font-semibold text-amber-800'
                : 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[0.68rem] font-semibold text-emerald-800'
            }
          >
            {hasLocalChanges ? (demoMode ? '画面内の変更あり' : '未保存の変更あり') : (demoMode ? '初期状態' : '編集前と同じ')}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={resetRows} disabled={!hasLocalChanges}>
              {demoMode ? '最初の状態に戻す' : '編集前に戻す'}
            </Button>
            {!demoMode && (
              <>
                <Button type="button" variant="secondary" size="sm" disabled>下書きを保存</Button>
                <Button type="button" size="sm" disabled>
                  {role === 'master_dealer' ? '本部へ承認申請' : '公開内容を確認'}
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-amber-50/45 px-3 py-1.5 text-[11px]">
          <span className="font-semibold text-slate-700">計算条件</span>
          <label className="flex items-center gap-1">
            <span className="text-slate-600">販売費</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={salesExpenseRate}
              onChange={(event) => setSalesExpenseRate(Math.max(0, Number(event.target.value)))}
              className="h-7 w-16 px-1.5 text-right text-xs"
              aria-label="販売費率"
            />
            <span>%</span>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-slate-600">経費</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={expenseRate}
              onChange={(event) => setExpenseRate(Math.max(0, Number(event.target.value)))}
              className="h-7 w-16 px-1.5 text-right text-xs"
              aria-label="経費率"
            />
            <span>%</span>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-slate-600">掛率</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={markupRate}
              onChange={(event) => setMarkupRate(Math.max(0, Number(event.target.value)))}
              className="h-7 w-16 px-1.5 text-right text-xs"
              aria-label="掛率"
            />
            <span>%</span>
          </label>
          <span className="border-l border-slate-300 pl-3 text-slate-600">
            粗利 <strong className="ml-1 text-slate-400">—</strong>
          </span>
          <span className="text-slate-600">
            粗利率 <strong className="ml-1 text-slate-400">—</strong>
          </span>
          <span className="ml-auto text-[10px] text-slate-500">画面内設定。明細金額への反映は正式原価接続後です。</span>
        </div>

        <div className="flex flex-wrap items-center divide-x divide-slate-200 border-b border-slate-200 text-xs">
          <span className="px-3 py-1.5">
            税別小計 <strong className="ml-1 text-sm text-slate-900">{formatYen(subtotalRaw)}</strong>
          </span>
          <label className="flex items-center gap-1 px-3 py-1">
            <span className="whitespace-nowrap text-slate-600">値引き等調整額</span>
            <Input
              type="number"
              step={1}
              value={localAdjustment}
              onChange={(event) => setLocalAdjustment(Number(event.target.value) || 0)}
              className="h-7 w-24 px-1.5 text-right text-xs"
              aria-label="値引き等調整額"
            />
          </label>
          <span className="px-3 py-1.5">
            消費税 <strong className="ml-1 text-sm text-slate-900">{formatYen(tax)}</strong>
          </span>
          <span className="px-3 py-1.5">
            税込合計 <strong className="ml-1 text-base text-slate-900">{formatYen(total)}</strong>
          </span>
          <span className="px-3 py-1.5 text-slate-500">Tab＝右へ ／ Enter＝下へ ／ Shift+Enter＝上へ</span>
        </div>

        <div className="flex items-end gap-1 bg-slate-100 px-3 pt-1.5">
          <button
            type="button"
            className={
              showCost
                ? 'rounded-t border border-slate-300 bg-slate-200 px-4 py-2 text-xs font-semibold text-slate-600'
                : 'rounded-t border border-b-white border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-800'
            }
            onClick={() => setShowCost(false)}
          >
            売価表
          </button>
          <button
            type="button"
            disabled
            title="正式原価の接続後に利用できます"
            className="cursor-not-allowed rounded-t border border-slate-300 bg-slate-200 px-4 py-2 text-xs font-semibold text-slate-400"
          >
            原価・売価比較（準備中）
          </button>
          <span className="ml-auto pb-2 text-[10px] text-slate-500">
            黄色＝入力 ／ グレー＝参照・自動表示 ／ 商品名の「…」＝商品選択
          </span>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm" data-testid="estimate-excel-grid">
        <div className="max-h-[68vh] overflow-auto">
          <table className={showCost ? 'min-w-[86rem] w-full border-collapse text-xs' : 'min-w-[66rem] w-full border-collapse text-xs'}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-40 w-11 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-center text-[11px] font-semibold text-slate-600">#</th>
                <th className="sticky left-[2.75rem] top-0 z-40 w-9 border-b border-r border-slate-300 bg-slate-100 px-1 py-1"></th>
                <th className="sticky left-[5rem] top-0 z-40 min-w-[20rem] border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-[11px] font-semibold text-slate-600">品名</th>
                <th className="sticky top-0 z-20 w-20 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-[11px] font-semibold text-slate-600">数量</th>
                <th className="sticky top-0 z-20 w-20 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-[11px] font-semibold text-slate-600">単位</th>
                {showCost && (
                  <>
                    <th className="sticky top-0 z-20 w-28 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-[11px] font-semibold text-slate-600">原価</th>
                    <th className="sticky top-0 z-20 w-28 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-[11px] font-semibold text-slate-600">原価金額</th>
                  </>
                )}
                <th className="sticky top-0 z-20 w-32 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-[11px] font-semibold text-slate-600">売価</th>
                <th className="sticky top-0 z-20 w-28 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-[11px] font-semibold text-slate-600">売価金額</th>
                {showCost && (
                  <th className="sticky top-0 z-20 w-28 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-[11px] font-semibold text-slate-600">粗利</th>
                )}
                <th className="sticky top-0 z-20 min-w-48 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-[11px] font-semibold text-slate-600">備考</th>
                <th className="sticky top-0 z-20 w-40 border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-[11px] font-semibold text-slate-600">お客様選択</th>
                <th className="sticky top-0 z-20 w-16 border-b border-slate-300 bg-slate-100 px-2 py-1 text-center text-[11px] font-semibold text-slate-600">操作</th>
              </tr>
            </thead>

            <tbody>
              {sectionHeader({
                key: 'base',
                label: '本体',
                totalAmount: baseTotal,
                rowCount: baseLines.length,
                expenseText: '本体マスター参照・読取専用',
                editable: false,
              })}
              {!collapsedSections.has('base') && baseLines.map(baseRow)}

              {sections.map((section) => {
                const sectionRows = rows.filter((row) => row.section === section.code);
                const expenseText =
                  section.expenseAmount > 0
                    ? (section.expenseLabel ?? '諸費用') + ' ' + formatYen(section.expenseAmount)
                    : undefined;
                return (
                  <Fragment key={section.code}>
                    {sectionHeader({
                      key: section.code,
                      label: section.label,
                      totalAmount: totals[section.code],
                      rowCount: sectionRows.length,
                      expenseText,
                      editable: true,
                    })}
                    {!collapsedSections.has(section.code) && sectionRows.map(editableRow)}
                  </Fragment>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-slate-500 bg-slate-50 font-semibold">
                <td colSpan={grandLabelSpan} className="px-3 py-2 text-right">税別小計</td>
                <td className="border-l border-slate-300 px-3 py-2 text-right tabular-nums">{formatYen(subtotalRaw)}</td>
                <td colSpan={grandTailSpan}></td>
              </tr>
              <tr className="border-t border-slate-300 bg-amber-50">
                <td colSpan={grandLabelSpan} className="px-3 py-2 text-right">値引き等調整額</td>
                <td className="border-l border-slate-300 px-3 py-2 text-right tabular-nums">{formatYen(localAdjustment)}</td>
                <td colSpan={grandTailSpan}></td>
              </tr>
              <tr className="border-t border-slate-300 bg-slate-50">
                <td colSpan={grandLabelSpan} className="px-3 py-2 text-right">消費税</td>
                <td className="border-l border-slate-300 px-3 py-2 text-right tabular-nums">{formatYen(tax)}</td>
                <td colSpan={grandTailSpan}></td>
              </tr>
              <tr className="border-t-2 border-emerald-800 bg-emerald-50 text-base font-bold">
                <td colSpan={grandLabelSpan} className="px-3 py-2.5 text-right">税込合計</td>
                <td className="border-l border-emerald-300 px-3 py-2.5 text-right tabular-nums">{formatYen(total)}</td>
                <td colSpan={grandTailSpan}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 bg-white px-3 py-2 text-[11px] text-slate-500">
          <span>本体は参照専用。内外装工事・オプション・別途はセルで編集できます。</span>
          <span>販売費・経費・掛率は画面内で調整できます。正式計算・保存・公開は準備中です。</span>
        </div>
      </section>

      {pickerSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="商品を選択">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{pickerTargetRowId ? '商品を変更' : '商品を追加'}</h2>
                <p className="mt-1 text-xs text-muted">
                  {pickerTargetRowId ? '選択した明細行へ商品情報を反映します。' : '選択した区分へ商品を追加します。'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
                    追加先：{pickerSectionLabel}
                  </span>
                  {pickerCategoryName && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700">
                      カテゴリー：{pickerCategoryName}
                    </span>
                  )}
                </div>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={closeProductPicker}>閉じる</button>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
                <Select value={pickerCategory} onChange={(event) => setPickerCategory(event.target.value)}>
                  <option value="">この区分のすべてのカテゴリー</option>
                  {pickerCategories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </Select>
                <Input
                  type="search"
                  value={pickerQuery}
                  onChange={(event) => setPickerQuery(event.target.value)}
                  placeholder="メーカー・商品名・シリーズ・型番で検索"
                />
              </div>

              <p className="text-[11px] text-muted">
                「{pickerSectionLabel}」に分類したカテゴリーの商品だけを表示しています。
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                {pickerProducts.map((product) => (
                  <article key={product.id} className="rounded-xl border border-line p-4">
                    <div className="flex gap-3">
                      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sand text-xs text-muted">
                        {product.imageUrl ? <span>画像登録済み</span> : <span>画像なし</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted">
                          {product.categoryName} ／ {product.manufacturer || 'メーカー未登録'}
                        </p>
                        <h3 className="font-semibold">{product.name}</h3>
                        <p className="mt-1 text-xs text-muted">
                          {[product.modelNo, product.sizeNote].filter(Boolean).join(' ／ ') || '型番・サイズ未登録'}
                        </p>
                        <p className="mt-2 text-sm font-semibold">
                          {product.priceOnRequest ? '別途見積' : '追加金額 ' + formatYen(product.price)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button type="button" className="btn-primary btn-sm" onClick={() => addProduct(product)}>
                        {pickerTargetRowId ? 'この商品に変更' : '追加'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              {pickerProducts.length === 0 && (
                <div className="rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">
                  この区分・カテゴリーの条件に一致する商品がありません。
                </div>
              )}

              {!demoMode && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                  <div>
                    <p className="font-semibold">商品が見つからない場合</p>
                    <p className="mt-1 text-xs text-muted">商品登録後、この標準見積へ戻れます。</p>
                  </div>
                  <Link
                    href={'/admin/options/new?return_to=' + encodeURIComponent('/admin/estimate-templates/' + templateId + '?return_section=' + pickerSection)}
                    className="btn-secondary btn-sm"
                  >
                    ＋ 新しい商品を登録
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
