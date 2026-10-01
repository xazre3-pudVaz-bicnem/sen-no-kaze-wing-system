'use client';

import { Fragment, useMemo, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { Package, Search, X } from 'lucide-react';
import type { QuoteItemKind } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { Button, Input } from '@/components/ui';
import { EstimateRateControls } from '@/components/admin/estimate-workbench-shared';

export type QuoteAuthoringSection = 'base' | 'interior_exterior' | 'option' | 'installation';
export type QuoteAuthoringTab = 'estimate' | 'planboard' | 'drawings';

export type QuoteAuthoringRow = {
  key: string;
  kind: QuoteItemKind;
  name: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  amount: number;
  remark: string | null;
  optionId?: string | null;
  locked?: boolean;
};

const DECIMAL_QUANTITY_UNITS = new Set(['m', 'ｍ', '㎡', 'm²', 'm2']);

export function quoteQuantityRule(unit: string | null | undefined): 'fixed-one' | 'decimal' | 'integer' {
  const normalized = (unit ?? '').trim().toLowerCase();
  if (normalized === '式') return 'fixed-one';
  if (DECIMAL_QUANTITY_UNITS.has(normalized)) return 'decimal';
  return 'integer';
}

export function isValidQuoteQuantity(quantity: number, unit: string | null | undefined): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 99_999) return false;
  const rule = quoteQuantityRule(unit);
  if (rule === 'fixed-one') return quantity === 1;
  if (rule === 'integer') return Number.isInteger(quantity);
  return Math.abs(quantity * 10_000 - Math.round(quantity * 10_000)) < 1e-7;
}

export type QuoteCatalogProduct = {
  id: string;
  baseModelId: string | null;
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
  specCodes: string[];
};

export type QuotePickerRow = {
  id: string;
  quote_no: string;
  case_name: string | null;
  customer_name: string;
  customer_company: string | null;
  base_model_name: string;
  revision: number;
  total: number;
  status_label: string;
  updated_at: string;
};

const SECTION_META: Array<{ key: QuoteAuthoringSection; label: string; kinds: QuoteItemKind[] }> = [
  { key: 'base', label: '本体', kinds: ['base', 'base_expense'] },
  { key: 'interior_exterior', label: '内外装工事', kinds: ['interior_exterior', 'interior_exterior_expense'] },
  { key: 'option', label: 'オプション', kinds: ['option', 'option_expense', 'free'] },
  { key: 'installation', label: '別途', kinds: ['installation'] },
];

const SECTION_PRODUCT_CATEGORY_CODES: Partial<Record<QuoteAuthoringSection, readonly string[]>> = {
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
};

const KIND_DETAIL_LABELS: Partial<Record<QuoteItemKind, string>> = {
  base_expense: '本体諸費用',
  interior_exterior_expense: '内外装工事経費',
  option_expense: 'オプション諸費用',
  free: '自由明細',
};

function sectionForKind(kind: QuoteItemKind): QuoteAuthoringSection {
  return SECTION_META.find((section) => section.kinds.includes(kind))?.key ?? 'option';
}

export function QuoteEditorTopbar({
  mode,
  estimates,
  confirmLeave,
}: {
  mode: 'new' | 'edit';
  estimates: QuotePickerRow[];
  confirmLeave?: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ja');
    if (!q) return estimates;
    return estimates.filter((estimate) =>
      [
        estimate.case_name,
        estimate.customer_name,
        estimate.customer_company,
        estimate.quote_no,
        estimate.base_model_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ja')
        .includes(q)
    );
  }, [estimates, query]);

  const isClonePicker = mode === 'new';

  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 shadow-sm">
        <span className="rounded-md bg-[#edf3f0] px-3 py-1.5 text-[10px] font-semibold text-[#315745]">
          {mode === 'new' ? '新規作成中' : '見積編集中'}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {isClonePicker ? '過去見積から複製' : '案件見積一覧'}
          </Button>
          {mode === 'edit' && (
            <Link
              href="/admin/quotes/new"
              className="btn-primary btn-sm"
              onClick={(event) => {
                if (confirmLeave && !confirmLeave()) event.preventDefault();
              }}
            >
              ＋ 新しい見積書を作成
            </Link>
          )}
        </div>
      </section>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-3 py-[8vh]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={isClonePicker ? '複製する過去見積を選択' : '案件見積一覧'}
            className="max-h-[78vh] w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
            data-testid="estimate-picker-dialog"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="font-semibold">
                  {isClonePicker ? '複製する過去見積を選択' : '案件見積一覧'}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  {isClonePicker
                    ? '案件名・顧客名・見積番号・商品モデルから正式Quote Revisionの複製元候補を確認できます。保存済みDraftを含む正式な複製処理はDB基盤接続後に利用できます。'
                    : '案件名・顧客名・見積番号・商品モデルから開けます。'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-muted hover:bg-sand hover:text-ink"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-line p-3">
              <label className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2">
                <Search className="h-4 w-4 text-muted" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="案件名・顧客名・見積番号・商品モデルで検索"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {filtered.map((estimate) =>
                isClonePicker ? (
                  <div
                    key={estimate.id}
                    className="grid gap-2 border-b border-line px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                    data-testid="estimate-clone-source-row"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{estimate.case_name || estimate.customer_name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {estimate.customer_name}
                        {estimate.customer_company ? ` ／ ${estimate.customer_company}` : ''}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">{estimate.quote_no} ／ Revision {estimate.revision}</p>
                    </div>
                    <div className="min-w-0 text-xs">
                      <p className="truncate font-semibold">{estimate.base_model_name}</p>
                      <p className="mt-0.5 text-muted">{estimate.status_label}</p>
                    </div>
                    <div className="flex min-w-[9rem] flex-col items-end justify-center gap-1.5">
                      <span className="text-sm font-semibold tabular-nums">{formatYen(estimate.total)}</span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled
                        title="正式な複製処理はDB基盤接続後に利用できます"
                      >
                        この見積を複製
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Link
                    key={estimate.id}
                    href={`/admin/quotes?case=${estimate.id}&tab=estimate#case-workspace`}
                    className="grid gap-1 border-b border-line px-4 py-3 hover:bg-[#f7faf8] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                    data-testid="estimate-picker-row"
                    onClick={(event) => {
                      if (confirmLeave && !confirmLeave()) event.preventDefault();
                    }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{estimate.case_name || estimate.customer_name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {estimate.customer_name}
                        {estimate.customer_company ? ` ／ ${estimate.customer_company}` : ''}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">{estimate.quote_no} ／ Revision {estimate.revision}</p>
                    </div>
                    <div className="min-w-0 text-xs">
                      <p className="truncate font-semibold">{estimate.base_model_name}</p>
                      <p className="mt-0.5 text-muted">{estimate.status_label}</p>
                    </div>
                    <div className="text-right text-sm font-semibold tabular-nums">{formatYen(estimate.total)}</div>
                  </Link>
                )
              )}
              {filtered.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted">
                  {isClonePicker ? '複製元にできる見積がありません。' : '該当する見積書がありません。'}
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function QuoteAuthoringTabs({
  active = 'estimate',
  onChange,
}: {
  active?: QuoteAuthoringTab;
  onChange?: (tab: QuoteAuthoringTab) => void;
} = {}) {
  const enabled = Boolean(onChange);
  const buttonClass = (tab: QuoteAuthoringTab) =>
    active === tab
      ? 'rounded-t border border-b-white border-slate-300 bg-white px-3 py-1.5 text-[10px] font-semibold text-emerald-800'
      : 'rounded-t border border-slate-300 bg-slate-100 px-3 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-white';

  return (
    <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-100 px-3 pt-1" aria-label="見積作業タブ">
      <button
        type="button"
        className={buttonClass('estimate')}
        aria-pressed={active === 'estimate'}
        onClick={() => onChange?.('estimate')}
      >
        見積書
      </button>
      <button
        type="button"
        disabled={!enabled}
        className={enabled ? buttonClass('planboard') : 'cursor-not-allowed rounded-t border border-slate-300 bg-slate-200 px-3 py-1.5 text-[10px] font-semibold text-slate-400'}
        aria-pressed={active === 'planboard'}
        onClick={() => onChange?.('planboard')}
      >
        プランボード
      </button>
      <button
        type="button"
        disabled={!enabled}
        className={enabled ? buttonClass('drawings') : 'cursor-not-allowed rounded-t border border-slate-300 bg-slate-200 px-3 py-1.5 text-[10px] font-semibold text-slate-400'}
        aria-pressed={active === 'drawings'}
        onClick={() => onChange?.('drawings')}
      >
        図面
      </button>
    </div>
  );
}

export function QuoteInternalRateStrip({
  showPlannedDefaults = false,
}: {
  showPlannedDefaults?: boolean;
} = {}) {
  if (showPlannedDefaults) {
    return (
      <EstimateRateControls
        values={{ salesExpenseRate: 100, expenseRate: 15, markupRate: 150 }}
        editable={false}
        valueNote="予定初期値"
        grossProfitLabel="未算定"
        grossProfitRateLabel="未算定"
        note="Quote Draftの正式保存項目に未接続のため、現在は編集・保存・見積金額計算に使用しません"
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-amber-50/35 px-3 py-1.5 text-[10px]">
      <span className="font-semibold text-slate-700">社内計算条件</span>
      <span>販売費 <strong className="text-slate-400">—</strong></span>
      <span>経費 <strong className="text-slate-400">—</strong></span>
      <span>掛率 <strong className="text-slate-400">—</strong></span>
      <span className="ml-auto text-[10px] text-slate-500">販売費・経費・掛率は現在の見積では使用していません</span>
    </div>
  );
}

export function QuoteAuthoringGrid({
  rows,
  products,
  baseModelId,
  specCode,
  onUpdate,
  onRemove,
  onAddFree,
  onSelectProduct,
}: {
  rows: QuoteAuthoringRow[];
  products: QuoteCatalogProduct[];
  baseModelId: string;
  specCode: string;
  onUpdate: (key: string, patch: Partial<Pick<QuoteAuthoringRow, 'name' | 'quantity' | 'unit' | 'unitPrice' | 'remark'>>) => void;
  onRemove: (key: string) => void;
  onAddFree: (section: QuoteAuthoringSection) => void;
  onSelectProduct: (section: QuoteAuthoringSection, targetKey: string | null, product: QuoteCatalogProduct) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<QuoteAuthoringSection>>(() => new Set());
  const [pickerSection, setPickerSection] = useState<QuoteAuthoringSection | null>(null);
  const [pickerTargetKey, setPickerTargetKey] = useState<string | null>(null);
  const [pickerCategoryId, setPickerCategoryId] = useState('');
  const [pickerQuery, setPickerQuery] = useState('');

  const sectionRows = (section: QuoteAuthoringSection) =>
    rows.filter((row) => sectionForKind(row.kind) === section);

  const pickerProducts = useMemo(() => {
    if (!pickerSection || !baseModelId || !specCode) return [];
    const allowedCodes = new Set(SECTION_PRODUCT_CATEGORY_CODES[pickerSection] ?? []);
    return products.filter(
      (product) =>
        allowedCodes.has(product.categoryCode) &&
        (product.baseModelId === null || product.baseModelId === baseModelId) &&
        (product.specCodes.length === 0 || product.specCodes.includes(specCode))
    );
  }, [baseModelId, pickerSection, products, specCode]);

  const pickerCategories = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of pickerProducts) map.set(product.categoryId, product.categoryName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [pickerProducts]);

  const visiblePickerProducts = useMemo(() => {
    const normalizedQuery = pickerQuery.trim().toLocaleLowerCase('ja');
    return pickerProducts.filter((product) => {
      if (pickerCategoryId && product.categoryId !== pickerCategoryId) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        product.name,
        product.manufacturer,
        product.modelNo,
        product.sizeNote,
        product.categoryName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ja');
      return haystack.includes(normalizedQuery);
    });
  }, [pickerCategoryId, pickerProducts, pickerQuery]);

  const selectedProductIds = useMemo(
    () => new Set(rows.map((row) => row.optionId).filter((id): id is string => Boolean(id))),
    [rows]
  );
  const pickerTargetOptionId =
    pickerTargetKey ? rows.find((row) => row.key === pickerTargetKey)?.optionId ?? null : null;

  const openProductPicker = (section: QuoteAuthoringSection, targetKey: string | null = null) => {
    setPickerSection(section);
    setPickerTargetKey(targetKey);
    setPickerCategoryId('');
    setPickerQuery('');
  };

  const closeProductPicker = () => {
    setPickerSection(null);
    setPickerTargetKey(null);
    setPickerCategoryId('');
    setPickerQuery('');
  };

  const canPickProduct = Boolean(baseModelId && specCode);


  const toggle = (section: QuoteAuthoringSection) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const rowNumberByKey = useMemo(() => {
    const map = new Map<string, number>();
    let number = 0;
    for (const section of SECTION_META) {
      for (const row of rows) {
        if (sectionForKind(row.kind) === section.key) map.set(row.key, ++number);
      }
    }
    return map;
  }, [rows]);

  const handleGridKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.key !== 'Enter') return;
    const col = event.currentTarget.dataset.quoteGridCol;
    if (!col) return;

    event.preventDefault();
    const grid = event.currentTarget.closest('[data-testid="unified-quote-excel-grid"]');
    const cells = Array.from(
      grid?.querySelectorAll<HTMLInputElement>(`[data-quote-grid-col="${col}"]`) ?? []
    ).filter((element) => !element.disabled && element.offsetParent !== null);
    const index = cells.indexOf(event.currentTarget);
    const target = cells[event.shiftKey ? index - 1 : index + 1];
    if (!target) return;
    target.focus();
    target.select();
  };

  const handleQuantityKeyDown = (event: KeyboardEvent<HTMLInputElement>, unit: string | null) => {
    handleGridKeyDown(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (quoteQuantityRule(unit) !== 'integer') return;
    if (['.', ',', 'e', 'E', '+', '-'].includes(event.key)) event.preventDefault();
  };

  return (
    <section className="overflow-hidden bg-white" data-testid="unified-quote-excel-grid">
      <div
        className="border-b border-slate-200 bg-slate-50 px-2 py-1 text-[9px] text-slate-500"
        data-testid="quote-grid-help"
      >
        Tab→ ／ Enter↓ ／ Shift+Enter↑ ｜ 数量：式＝1固定 ／ 個・台・枚＝整数 ／ m・㎡＝小数可 ｜ 黄色＝入力 ／ グレー＝参照 ｜ 別途見積＝合計に含めない ／ —＝この画面では表示なし
      </div>
      <div className="overflow-x-auto md:overflow-x-visible">
        <table className="w-full min-w-[46rem] table-fixed border-collapse text-[10px] md:min-w-0">
          <colgroup>
            <col className="w-7" />
            <col className="w-7" />
            <col className="w-[10.5rem]" />
            <col className="w-10" />
            <col className="w-9" />
            <col className="w-14" />
            <col className="w-16" />
            <col className="w-14" />
            <col className="w-16" />
            <col className="w-16" />
            <col className="w-24" />
            <col className="w-10" />
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-40 w-7 border-b border-r border-slate-300 bg-slate-100 px-1 py-1 text-center text-[9px] font-semibold leading-tight text-slate-600">#</th>
              <th className="sticky left-[1.75rem] top-0 z-40 w-7 border-b border-r border-slate-300 bg-slate-100 px-1 py-1"></th>
              <th className="sticky left-[3.5rem] top-0 z-40 w-[10.5rem] border-b border-r border-slate-300 bg-slate-100 px-1.5 py-1 text-left text-[9px] font-semibold leading-tight text-slate-600">品名</th>
              <th className="sticky top-0 z-20 w-10 border-b border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[9px] font-semibold leading-tight text-slate-600">数量</th>
              <th className="sticky top-0 z-20 w-9 border-b border-r border-slate-300 bg-slate-100 px-1 py-1 text-left text-[9px] font-semibold leading-tight text-slate-600">単位</th>
              <th className="sticky top-0 z-20 w-14 border-b border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[9px] font-semibold leading-tight text-slate-600">原価</th>
              <th className="sticky top-0 z-20 w-16 border-b border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[9px] font-semibold leading-tight text-slate-600">原価金額</th>
              <th className="sticky top-0 z-20 w-14 border-b border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[9px] font-semibold leading-tight text-slate-600">売価</th>
              <th className="sticky top-0 z-20 w-16 border-b border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[9px] font-semibold leading-tight text-slate-600">売価金額</th>
              <th className="sticky top-0 z-20 w-16 border-b border-r border-slate-300 bg-slate-100 px-1 py-1 text-right text-[9px] font-semibold leading-tight text-slate-600">粗利</th>
              <th className="sticky top-0 z-20 w-24 border-b border-r border-slate-300 bg-slate-100 px-1 py-1 text-left text-[9px] font-semibold leading-tight text-slate-600">備考</th>
              <th className="sticky top-0 z-20 w-10 border-b border-slate-300 bg-slate-100 px-1 py-1 text-center text-[9px] font-semibold leading-tight text-slate-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {SECTION_META.map((section) => {
              const currentRows = sectionRows(section.key);
              const isCollapsed = collapsed.has(section.key);
              const sectionSale = currentRows.reduce((sum, row) => sum + row.amount, 0);
              const separate = currentRows.some((row) => row.unitPrice === 0 && row.remark?.trim() === '別途見積');
              const hasSeparatePrice = section.key === 'installation' && separate;
              const collapsedAmount = hasSeparatePrice ? '別途見積' : formatYen(sectionSale);
              const summaryRemark = hasSeparatePrice
                ? `${currentRows.length}行 ／ 別途見積を含む`
                : `${currentRows.length}行の明細を集約`;

              if (isCollapsed) {
                return (
                  <tr
                    key={section.key}
                    className="border-b border-emerald-950 bg-emerald-900 text-white"
                    data-testid={`quote-section-summary-${section.key}`}
                  >
                    <th className="sticky left-0 z-20 w-7 bg-slate-100"></th>
                    <td className="sticky left-[1.75rem] z-20 w-7 border-r border-emerald-800 bg-emerald-900 px-1 text-center">
                      <button
                        type="button"
                        className="my-px flex size-4 items-center justify-center rounded border border-white/60 bg-white text-xs font-bold text-slate-800"
                        onClick={() => toggle(section.key)}
                        aria-expanded={false}
                        aria-label={section.label + 'の明細を開く'}
                      >
                        +
                      </button>
                    </td>
                    <td className="sticky left-[3.5rem] z-20 w-[10.5rem] border-r border-emerald-800 bg-emerald-900 px-1.5 py-0.5">
                      <div className="flex items-center gap-2">
                        <strong className="text-[10px]">{section.label}</strong>
                        <span className="text-[9px] text-white/75">{currentRows.length}行</span>
                      </div>
                    </td>
                    <td className="w-10 border-r border-emerald-800 px-2 text-right text-[10px] font-semibold tabular-nums">1</td>
                    <td className="w-9 border-r border-emerald-800 px-1 text-[10px] font-semibold">式</td>
                    <td className="w-14 border-r border-emerald-800 px-1 text-right text-white/60">—</td>
                    <td className="w-16 border-r border-emerald-800 px-1 text-right text-white/60">—</td>
                    <td className="w-14 border-r border-emerald-800 px-1 text-right text-[10px] font-semibold tabular-nums">{collapsedAmount}</td>
                    <td className="w-16 border-r border-emerald-800 px-1 text-right text-[10px] font-semibold tabular-nums">{collapsedAmount}</td>
                    <td className="w-16 border-r border-emerald-800 px-1 text-right text-white/60">—</td>
                    <td className="w-24 border-r border-emerald-800 px-2 text-[9px] text-white/75">{summaryRemark}</td>
                    <td className="w-10 px-0.5 text-center text-[9px] text-white/60">—</td>
                  </tr>
                );
              }

              return (
                <Fragment key={section.key}>
                  <tr className="border-b border-emerald-950 bg-emerald-900 text-white">
                    <th className="sticky left-0 z-20 w-7 bg-slate-100"></th>
                    <td className="sticky left-[1.75rem] z-20 w-7 border-r border-emerald-800 bg-emerald-900 px-1 text-center">
                      <button
                        type="button"
                        className="my-px flex size-4 items-center justify-center rounded border border-white/60 bg-white text-xs font-bold text-slate-800"
                        onClick={() => toggle(section.key)}
                        aria-expanded={true}
                        aria-label={section.label + 'の明細を閉じる'}
                      >
                        −
                      </button>
                    </td>
                    <td className="sticky left-[3.5rem] z-20 w-[10.5rem] border-r border-emerald-800 bg-emerald-900 px-1.5 py-0.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <strong className="text-[10px]">{section.label}</strong>
                        <span className="text-[9px] text-white/75">{currentRows.length}行</span>
                        {SECTION_PRODUCT_CATEGORY_CODES[section.key]?.length ? (
                          <>
                            <button
                              type="button"
                              disabled={!canPickProduct}
                              className="text-[9px] font-semibold underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
                              onClick={() => openProductPicker(section.key)}
                              title={canPickProduct ? '商品台帳から追加' : '商品モデルと仕様を先に選択してください'}
                            >
                              ＋商品
                            </button>
                            <button
                              type="button"
                              className="text-[9px] font-semibold underline underline-offset-2"
                              onClick={() => onAddFree(section.key)}
                            >
                              ＋自由明細
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="text-[9px] font-semibold underline underline-offset-2"
                            onClick={() => onAddFree(section.key)}
                          >
                            ＋自由明細
                          </button>
                        )}
                      </div>
                    </td>
                    <td colSpan={9} className="bg-emerald-900 px-1.5 py-0.5">
                      <div className="flex items-center justify-end gap-3">
                        {section.key === 'installation' && separate && (
                          <span className="text-[9px] text-white/75">別途見積を含む</span>
                        )}
                        <span className="text-[10px] font-semibold">
                          {section.key === 'installation' && separate ? '別途見積' : formatYen(sectionSale)}
                        </span>
                      </div>
                    </td>
                  </tr>

                  {currentRows.map((row) => {
                    const number = rowNumberByKey.get(row.key) ?? 0;
                    const detailLabel = KIND_DETAIL_LABELS[row.kind];
                    const separatePrice = row.unitPrice === 0 && row.remark?.trim() === '別途見積';
                    const editCellClass = row.locked ? 'bg-slate-100' : 'bg-amber-50';

                    return (
                      <tr key={row.key} className="border-b border-slate-200 bg-white">
                        <th className="sticky left-0 z-10 w-7 border-r border-slate-200 bg-slate-100 px-1 text-center text-[10px] font-normal text-slate-500">{number}</th>
                        <td className="sticky left-[1.75rem] z-10 w-7 border-r border-slate-200 bg-white"></td>
                        <td className={`sticky left-[3.5rem] z-10 w-[10.5rem] border-r border-slate-200 px-0.5 ${editCellClass}`}>
                          <div className="flex items-center gap-0.5">
                            <Input
                              value={row.name}
                              disabled={row.locked}
                              data-quote-grid-col="name"
                              onKeyDown={handleGridKeyDown}
                              onChange={(event) => onUpdate(row.key, { name: event.target.value })}
                              className="h-5 min-h-5 min-w-0 flex-1 border-0 bg-transparent px-1 text-[10px] shadow-none focus:ring-2 focus:ring-emerald-700/30"
                              aria-label={`品名 ${number}`}
                            />
                            {!row.locked && SECTION_PRODUCT_CATEGORY_CODES[section.key]?.length ? (
                              <button
                                type="button"
                                disabled={!canPickProduct}
                                title={canPickProduct ? '商品台帳から選ぶ' : '商品モデルと仕様を先に選択してください'}
                                aria-label={`${row.name || 'この明細'}を商品台帳から選び直す`}
                                className="flex size-4 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-emerald-800 hover:border-emerald-700 disabled:cursor-not-allowed disabled:opacity-35"
                                onClick={() => openProductPicker(section.key, row.key)}
                              >
                                <Package className="size-3" aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                          {detailLabel && <span className="block truncate px-1 text-[9px] text-slate-500">{detailLabel}</span>}
                        </td>
                        <td className={`w-10 border-r border-slate-200 px-0.5 ${editCellClass}`}>
                          <Input
                            type="number"
                            min={quoteQuantityRule(row.unit) === 'integer' ? '1' : '0.01'}
                            max="99999"
                            step={quoteQuantityRule(row.unit) === 'decimal' ? '0.01' : '1'}
                            value={quoteQuantityRule(row.unit) === 'fixed-one' ? 1 : row.quantity}
                            disabled={row.locked}
                            readOnly={!row.locked && quoteQuantityRule(row.unit) === 'fixed-one'}
                            inputMode={quoteQuantityRule(row.unit) === 'decimal' ? 'decimal' : 'numeric'}
                            title={
                              quoteQuantityRule(row.unit) === 'fixed-one'
                                ? '単位「式」は数量1固定です'
                                : quoteQuantityRule(row.unit) === 'decimal'
                                  ? 'この単位は小数入力できます'
                                  : 'この単位は整数のみです'
                            }
                            data-quote-grid-col="quantity"
                            onKeyDown={(event) => handleQuantityKeyDown(event, row.unit)}
                            onChange={(event) => {
                              const quantity = Number(event.target.value);
                              if (isValidQuoteQuantity(quantity, row.unit)) onUpdate(row.key, { quantity });
                            }}
                            className={`h-5 min-h-5 w-full border-0 bg-transparent px-1 text-right text-[10px] shadow-none focus:ring-2 focus:ring-emerald-700/30 ${quoteQuantityRule(row.unit) === 'fixed-one' ? 'cursor-default text-slate-500' : ''}`}
                            aria-label={`数量 ${number}`}
                          />
                        </td>
                        <td className={`w-9 border-r border-slate-200 px-0.5 ${editCellClass}`}>
                          <Input
                            value={row.unit ?? ''}
                            disabled={row.locked}
                            data-quote-grid-col="unit"
                            onKeyDown={handleGridKeyDown}
                            onChange={(event) => {
                              const nextUnit = event.target.value;
                              if (quoteQuantityRule(nextUnit) === 'fixed-one') {
                                event.currentTarget.setCustomValidity('');
                                onUpdate(row.key, { unit: nextUnit, quantity: 1 });
                                return;
                              }
                              if (!isValidQuoteQuantity(row.quantity, nextUnit)) {
                                event.currentTarget.setCustomValidity('この単位では数量は整数で入力してください。先に数量を整数に変更してください。');
                                event.currentTarget.reportValidity();
                                return;
                              }
                              event.currentTarget.setCustomValidity('');
                              onUpdate(row.key, { unit: nextUnit });
                            }}
                            className="h-5 min-h-5 w-full border-0 bg-transparent px-1 text-[10px] shadow-none focus:ring-2 focus:ring-emerald-700/30"
                            aria-label={`単位 ${number}`}
                          />
                        </td>
                        <td className="w-14 border-r border-slate-200 bg-slate-50 px-2 text-right text-slate-400" title="原価は現在この画面では表示していません">—</td>
                        <td className="w-16 border-r border-slate-200 bg-slate-50 px-1 text-right text-slate-400" title="原価は現在この画面では表示していません">—</td>
                        <td className={`w-14 border-r border-slate-200 px-0.5 ${editCellClass}`}>
                          {separatePrice ? (
                            <div className="flex h-5 items-center justify-end px-1 text-[9px] font-semibold text-amber-900">別途見積</div>
                          ) : (
                            <Input
                              type="number"
                              step="1"
                              value={row.unitPrice}
                              disabled={row.locked}
                              data-quote-grid-col="sale"
                              onKeyDown={handleGridKeyDown}
                              onChange={(event) => onUpdate(row.key, { unitPrice: Number(event.target.value) || 0 })}
                              className="h-5 min-h-5 w-full border-0 bg-transparent px-1 text-right text-[10px] shadow-none focus:ring-2 focus:ring-emerald-700/30"
                              aria-label={`売価 ${number}`}
                            />
                          )}
                        </td>
                        <td className="w-16 whitespace-nowrap border-r border-slate-200 bg-slate-50 px-2 text-right tabular-nums">{separatePrice ? '—' : formatYen(row.amount)}</td>
                        <td className="w-16 border-r border-slate-200 bg-slate-50 px-1 text-right text-slate-400" title="原価は現在この画面では表示していません">—</td>
                        <td className={`w-24 border-r border-slate-200 px-0.5 ${editCellClass}`}>
                          <Input
                            value={row.remark ?? ''}
                            disabled={row.locked}
                            data-quote-grid-col="remark"
                            onKeyDown={handleGridKeyDown}
                            onChange={(event) => onUpdate(row.key, { remark: event.target.value })}
                            className="h-5 min-h-5 w-full border-0 bg-transparent px-1 text-[10px] shadow-none focus:ring-2 focus:ring-emerald-700/30"
                            aria-label={`備考 ${number}`}
                          />
                        </td>
                        <td className="w-10 px-0.5 text-center">
                          <button
                            type="button"
                            disabled={row.locked}
                            onClick={() => onRemove(row.key)}
                            className="rounded px-1 py-0.5 text-[10px] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {currentRows.length > 0 && <tr className="border-y border-emerald-800 bg-emerald-50 font-semibold">
                    <th className="sticky left-0 z-10 w-7 bg-slate-100"></th>
                    <td className="sticky left-[1.75rem] z-10 w-7 bg-emerald-50"></td>
                    <td className="sticky left-[3.5rem] z-10 w-[10.5rem] bg-emerald-50 px-1.5 py-0.5 text-[10px]">{section.label} 計</td>
                    <td></td>
                    <td></td>
                    <td className="px-1 text-right text-slate-400">—</td>
                    <td></td>
                    <td className="px-1 text-right">{section.key === 'installation' && separate ? '別途見積' : formatYen(sectionSale)}</td>
                    <td></td>
                    <td className="px-1 text-right text-slate-400">—</td>
                    <td></td>
                    <td></td>
                  </tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {pickerSection && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-3 py-[7vh]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeProductPicker();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="商品台帳から選択"
            className="max-h-[82vh] w-full max-w-4xl overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
            data-testid="quote-product-picker-dialog"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="font-semibold">{pickerTargetKey ? '商品台帳から選択' : '商品台帳から追加'}</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {SECTION_META.find((section) => section.key === pickerSection)?.label}で使用できる公開商品です。
                </p>
              </div>
              <button
                type="button"
                onClick={closeProductPicker}
                className="rounded-md p-2 text-muted hover:bg-sand hover:text-ink"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-line bg-sand/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <Input
                    type="search"
                    value={pickerQuery}
                    onChange={(event) => setPickerQuery(event.target.value)}
                    placeholder="商品名・メーカー・型番・サイズで検索"
                    className="h-9 pl-9 text-sm"
                    aria-label="商品台帳を検索"
                    data-testid="quote-product-picker-search"
                  />
                </div>
                <span className="shrink-0 text-xs text-muted">{visiblePickerProducts.length}件</span>
              </div>
            </div>

            {pickerCategories.length > 1 && (
              <div className="overflow-x-auto border-b border-line px-4 py-2" data-testid="quote-product-picker-categories">
                <div className="flex min-w-max gap-1">
                  <button
                    type="button"
                    aria-pressed={pickerCategoryId === ''}
                    onClick={() => setPickerCategoryId('')}
                    className={pickerCategoryId === '' ? 'rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white' : 'rounded-full border border-line bg-white px-3 py-1 text-xs'}
                  >
                    すべて
                  </button>
                  {pickerCategories.map(([id, name]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={pickerCategoryId === id}
                      onClick={() => setPickerCategoryId(id)}
                      className={pickerCategoryId === id ? 'rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white' : 'rounded-full border border-line bg-white px-3 py-1 text-xs'}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-[60vh] overflow-y-auto p-4">
              {visiblePickerProducts.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {visiblePickerProducts.map((product) => {
                    const isCurrent = pickerTargetOptionId === product.id;
                    const alreadyAdded = selectedProductIds.has(product.id) && !isCurrent;
                    const hasMakerOrModel = Boolean(product.manufacturer || product.modelNo || product.sizeNote);
                    return (
                      <article
                        key={product.id}
                        className={`overflow-hidden rounded-xl border bg-white ${isCurrent || alreadyAdded ? 'border-emerald-200 bg-emerald-50/20' : 'border-line'}`}
                      >
                        <div
                          className="flex h-36 items-center justify-center bg-slate-100 bg-contain bg-center bg-no-repeat text-xs text-muted sm:h-40"
                          style={product.imageUrl ? { backgroundImage: `url("${product.imageUrl}")` } : undefined}
                          role={product.imageUrl ? 'img' : undefined}
                          aria-label={product.imageUrl ? product.name + 'の商品画像' : undefined}
                        >
                          {!product.imageUrl && <span>画像なし</span>}
                        </div>
                        <div className="space-y-1.5 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-semibold text-muted">{product.categoryName}</p>
                              <h3 className="truncate text-sm font-semibold">{product.name}</h3>
                            </div>
                            {(isCurrent || alreadyAdded) && (
                              <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                {isCurrent ? '選択中' : '追加済み'}
                              </span>
                            )}
                          </div>
                          {hasMakerOrModel && (
                            <p className="truncate text-xs text-muted">
                              {[product.manufacturer, product.modelNo, product.sizeNote].filter(Boolean).join(' ／ ')}
                            </p>
                          )}
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <div className="min-w-0">
                              <strong className="text-sm">{product.priceOnRequest ? '別途見積' : formatYen(product.price)}</strong>
                              {!product.priceOnRequest && product.price === 0 && (
                                <span className="ml-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                  登録価格：0円
                                </span>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              disabled={isCurrent || alreadyAdded}
                              onClick={() => {
                                onSelectProduct(pickerSection, pickerTargetKey, product);
                                closeProductPicker();
                              }}
                            >
                              {isCurrent ? '選択中' : alreadyAdded ? '追加済み' : pickerTargetKey ? 'この商品を選ぶ' : '追加'}
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-muted">
                  <p>{pickerQuery.trim() ? '検索条件に一致する商品がありません。' : 'この商品モデル・仕様で選択できる公開商品はありません。'}</p>
                  {pickerQuery.trim() && (
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold underline underline-offset-2"
                      onClick={() => setPickerQuery('')}
                    >
                      検索をクリア
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export function QuoteFinancialSummary({
  subtotalRaw,
  adjustment,
  adjustmentReason,
  tax,
  total,
  onAdjustment,
  onAdjustmentReason,
}: {
  subtotalRaw: number;
  adjustment: number;
  adjustmentReason: string;
  tax: number;
  total: number;
  onAdjustment: (value: number) => void;
  onAdjustmentReason: (value: string) => void;
}) {
  return (
    <section className="ml-auto w-full max-w-lg rounded-lg border border-slate-300 bg-white p-3 text-xs shadow-sm">
      <div className="flex justify-between gap-4 py-0.5"><span>原価合計</span><strong className="text-slate-500">未算定</strong></div>
      <div className="flex justify-between gap-4 py-0.5"><span>売価明細合計</span><strong>{formatYen(subtotalRaw)}</strong></div>
      <div className="flex justify-between gap-4 py-0.5"><span>経費</span><strong className="text-slate-500" title="現行Quote Draftでは正式保存していません">未算定</strong></div>
      <label className="flex items-center justify-between gap-4 py-0.5">
        <span>調整額</span>
        <Input type="number" step="1" value={adjustment} onChange={(event) => onAdjustment(Number(event.target.value) || 0)} className="h-6 w-28 text-right text-xs" />
      </label>
      <label className="block py-1">
        <span className="text-[10px] text-muted">調整理由</span>
        <Input value={adjustmentReason} onChange={(event) => onAdjustmentReason(event.target.value)} placeholder={adjustment === 0 ? '調整なし' : '必須'} className="mt-0.5 h-6 text-xs" />
      </label>
      <div className="flex justify-between gap-4 py-0.5"><span>消費税</span><strong>{formatYen(tax)}</strong></div>
      <div className="mt-1.5 flex justify-between gap-4 border-t-2 border-slate-700 pt-2 text-base"><span>見積金額</span><strong>{formatYen(total)}</strong></div>
      <div className="mt-1.5 flex justify-between gap-4 rounded bg-emerald-50 px-2 py-1.5"><span>粗利</span><strong className="text-slate-600">未算定</strong></div>
      <div className="flex justify-between gap-4 py-0.5"><span>粗利率</span><strong className="text-slate-600">未算定</strong></div>
      <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
        原価が現行Quote Draftの正式保存項目に未接続のため、粗利・粗利率は0として扱わず未算定と表示します。
      </p>
    </section>
  );
}

const CUSTOMER_PREVIEW_SECTIONS: Array<{
  key: QuoteAuthoringSection | 'free';
  label: string;
  kinds: QuoteItemKind[];
  subtotalLabel: string | null;
}> = [
  { key: 'base', label: '本体', kinds: ['base', 'base_expense'], subtotalLabel: '【本体価格計】' },
  {
    key: 'interior_exterior',
    label: '内外装工事',
    kinds: ['interior_exterior', 'interior_exterior_expense'],
    subtotalLabel: '【内外装価格計】',
  },
  { key: 'option', label: 'オプション', kinds: ['option', 'option_expense'], subtotalLabel: '【オプション価格計】' },
  { key: 'free', label: '自由明細', kinds: ['free'], subtotalLabel: null },
  // installation の正式業務区分は未確定のため、既存の中立表記を維持し、小計ラベルは付けない。
  { key: 'installation', label: '別途', kinds: ['installation'], subtotalLabel: null },
];

function customerPreviewLineName(row: QuoteAuthoringRow): string {
  if (row.kind === 'interior_exterior_expense') {
    return '内外装諸費用（交通費、労災、安全管理費等）';
  }
  return row.name;
}

function customerPreviewRowAmount(row: QuoteAuthoringRow): number {
  return row.unitPrice === 0 && row.remark?.trim() === '別途見積' ? 0 : row.amount;
}

export function CustomerQuotePreview({
  caseName,
  customerName,
  companyName,
  address,
  phone,
  customerNo,
  submittedAt,
  contractedAt,
  rows,
  subtotal,
  adjustment,
  tax,
  total,
}: {
  caseName: string;
  customerName: string;
  companyName: string;
  address: string;
  phone: string;
  customerNo?: string | null;
  submittedAt?: string | null;
  contractedAt?: string | null;
  rows: QuoteAuthoringRow[];
  subtotal: number;
  adjustment: number;
  tax: number;
  total: number;
}) {
  return (
    <section data-testid="customer-quote-preview" className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-muted">お客様向け見積書プレビュー</p>
          <h2 className="text-lg font-semibold">御見積書</h2>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" disabled title="正式PDF発行処理は今回の対象外です">PDF</Button>
          <Button type="button" variant="secondary" size="sm" disabled title="正式発行・印刷処理は今回の対象外です">印刷</Button>
        </div>
      </div>

      <div className="grid gap-4 border-b border-slate-200 p-4 text-xs xl:grid-cols-3">
        <section>
          <h3 className="mb-2 text-[10px] font-semibold tracking-wide text-muted">お客様情報</h3>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1">
            <dt className="text-muted">会社名</dt><dd className="font-semibold">{companyName || '未設定'}</dd>
            <dt className="text-muted">お客様名</dt><dd className="font-semibold">{customerName || '未設定'}</dd>
            <dt className="text-muted">住所</dt><dd>{address || '未設定'}</dd>
            <dt className="text-muted">TEL</dt><dd>{phone || '未設定'}</dd>
            <dt className="text-muted">顧客番号</dt><dd>{customerNo || '未設定'}</dd>
            <dt className="text-muted">件名</dt><dd className="font-semibold">{caseName || '未設定'}</dd>
            <dt className="text-muted">見積提出日</dt><dd>{submittedAt || '未設定'}</dd>
            <dt className="text-muted">受注契約日</dt><dd>{contractedAt || '未設定'}</dd>
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold tracking-wide text-muted">発行者情報</h3>
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1">
            <dt className="text-muted">発行会社名／代理店名</dt><dd>未設定</dd>
            <dt className="text-muted">担当者</dt><dd>未設定</dd>
            <dt className="text-muted">住所</dt><dd>未設定</dd>
            <dt className="text-muted">TEL</dt><dd>未設定</dd>
            <dt className="text-muted">適格請求書発行事業者登録番号</dt><dd>未設定</dd>
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold tracking-wide text-muted">支払情報</h3>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1">
            <dt className="text-muted">支払条件</dt><dd>未設定</dd>
            <dt className="text-muted">振込先</dt><dd>未設定</dd>
            <dt className="text-muted">銀行名</dt><dd>未設定</dd>
            <dt className="text-muted">支店名</dt><dd>未設定</dd>
            <dt className="text-muted">口座種別</dt><dd>未設定</dd>
            <dt className="text-muted">口座番号</dt><dd>未設定</dd>
            <dt className="text-muted">口座名義</dt><dd>未設定</dd>
          </dl>
        </section>
      </div>

      <div className="overflow-x-auto p-3 sm:p-4">
        <table className="w-full min-w-[44rem] border-collapse text-xs sm:min-w-[48rem]">
          <thead>
            <tr className="border-y border-slate-300 bg-slate-50 text-slate-600">
              <th className="w-24 px-2 py-1.5 text-left">区分</th>
              <th className="px-2 py-1.5 text-left">品名</th>
              <th className="w-16 px-2 py-1.5 text-right">数量</th>
              <th className="w-14 px-2 py-1.5 text-left">単位</th>
              <th className="w-24 px-2 py-1.5 text-right">単価</th>
              <th className="w-24 px-2 py-1.5 text-right">金額</th>
              <th className="min-w-36 px-2 py-1.5 text-left">備考</th>
            </tr>
          </thead>
          <tbody>
            {CUSTOMER_PREVIEW_SECTIONS.map((section) => {
              const sectionRows = rows.filter((row) => section.kinds.includes(row.kind));
              if (sectionRows.length === 0) return null;

              const sectionTotal = sectionRows.reduce((sum, row) => sum + customerPreviewRowAmount(row), 0);
              const isOptionSection = section.key === 'option';
              const bodyAndOptionTotal =
                isOptionSection
                  ? rows
                      .filter((row) =>
                        ['base', 'base_expense', 'interior_exterior', 'interior_exterior_expense', 'option', 'option_expense'].includes(row.kind)
                      )
                      .reduce((sum, row) => sum + customerPreviewRowAmount(row), 0)
                  : 0;

              return (
                <Fragment key={section.key}>
                  <tr className="border-y border-slate-300 bg-slate-100/80">
                    <th colSpan={7} className="px-2 py-1.5 text-left text-xs font-semibold tracking-wide text-slate-700">
                      {section.label}
                    </th>
                  </tr>
                  {sectionRows.map((row) => {
                    const separate = row.unitPrice === 0 && row.remark?.trim() === '別途見積';
                    return (
                      <tr key={row.key} className="border-b border-slate-200">
                        <td className="px-2 py-1.5 font-semibold text-slate-600">{section.label}</td>
                        <td className="px-2 py-1.5">{customerPreviewLineName(row)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{row.quantity}</td>
                        <td className="px-2 py-1.5">{row.unit || '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{separate ? '別途見積' : formatYen(row.unitPrice)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{separate ? '—' : formatYen(row.amount)}</td>
                        <td className="px-2 py-1.5 text-slate-600">{row.remark || ''}</td>
                      </tr>
                    );
                  })}
                  {section.subtotalLabel && (
                    <tr className="border-b border-slate-300 bg-slate-50 font-semibold">
                      <td colSpan={5} className="px-2 py-1.5 text-right">{section.subtotalLabel}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(sectionTotal)}</td>
                      <td></td>
                    </tr>
                  )}
                  {isOptionSection && (
                    <tr className="border-b-2 border-slate-400 bg-slate-100 font-semibold">
                      <td colSpan={5} className="px-2 py-1.5 text-right">【本体＋内外装＋オプション価格計】</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(bodyAndOptionTotal)}</td>
                      <td></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">明細はまだありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="ml-auto w-full max-w-md space-y-1 border-t border-slate-200 px-4 py-4 text-sm sm:px-5">
        <div className="flex justify-between gap-4"><span>小計</span><strong>{formatYen(subtotal)}</strong></div>
        <div className="flex justify-between gap-4"><span>値引き等調整額</span><strong>{formatYen(adjustment)}</strong></div>
        <div className="flex justify-between gap-4"><span>税抜請負額</span><strong>{formatYen(Math.max(0, subtotal + adjustment))}</strong></div>
        <div className="flex justify-between gap-4"><span>消費税</span><strong>{formatYen(tax)}</strong></div>
        <div className="mt-1 flex justify-between gap-4 border-t-2 border-slate-600 pt-2 text-lg">
          <span>合計（税込）</span><strong>{formatYen(total)}</strong>
        </div>
      </div>
    </section>
  );
}
