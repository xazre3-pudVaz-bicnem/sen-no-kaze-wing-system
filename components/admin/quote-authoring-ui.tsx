'use client';

import { Fragment, useMemo, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { Search, X } from 'lucide-react';
import type { QuoteItemKind } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { Button, Input } from '@/components/ui';

export type QuoteAuthoringSection = 'base' | 'interior_exterior' | 'option' | 'installation';

export type QuoteAuthoringRow = {
  key: string;
  kind: QuoteItemKind;
  name: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  amount: number;
  remark: string | null;
  locked?: boolean;
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

  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 shadow-sm">
        <span className="rounded-md bg-[#edf3f0] px-3 py-1.5 text-[10px] font-semibold text-[#315745]">
          {mode === 'new' ? '新規作成中' : '見積編集中'}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
            案件見積一覧
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
            aria-label="案件見積一覧"
            className="max-h-[78vh] w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
            data-testid="estimate-picker-dialog"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="font-semibold">案件見積一覧</h2>
                <p className="mt-0.5 text-xs text-muted">案件名・顧客名・見積番号・商品モデルから開けます。</p>
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
              {filtered.map((estimate) => (
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
              ))}
              {filtered.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted">該当する見積書がありません。</p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function QuoteAuthoringTabs() {
  return (
    <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-100 px-3 pt-1" aria-label="見積作業タブ">
      <button type="button" className="rounded-t border border-b-white border-slate-300 bg-white px-3 py-1.5 text-[10px] font-semibold text-emerald-800">見積書</button>
      <button type="button" disabled className="cursor-not-allowed rounded-t border border-slate-300 bg-slate-200 px-3 py-1.5 text-[10px] font-semibold text-slate-400">プランボード</button>
      <button type="button" disabled className="cursor-not-allowed rounded-t border border-slate-300 bg-slate-200 px-3 py-1.5 text-[10px] font-semibold text-slate-400">図面</button>
    </div>
  );
}

export function QuoteInternalRateStrip() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-amber-50/35 px-3 py-1.5 text-[10px]">
      <span className="font-semibold text-slate-700">社内計算条件</span>
      <span>販売費 <strong className="text-slate-400">未接続</strong></span>
      <span>経費 <strong className="text-slate-400">未接続</strong></span>
      <span>掛率 <strong className="text-slate-400">未接続</strong></span>
      <span className="ml-auto text-[10px] text-slate-500">Quote Draftの正式金額ロジックは変更していません</span>
    </div>
  );
}

export function QuoteAuthoringGrid({
  rows,
  onUpdate,
  onRemove,
  onAdd,
}: {
  rows: QuoteAuthoringRow[];
  onUpdate: (key: string, patch: Partial<Pick<QuoteAuthoringRow, 'name' | 'quantity' | 'unit' | 'unitPrice' | 'remark'>>) => void;
  onRemove: (key: string) => void;
  onAdd: (section: QuoteAuthoringSection) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<QuoteAuthoringSection>>(() => new Set());

  const sectionRows = (section: QuoteAuthoringSection) =>
    rows.filter((row) => sectionForKind(row.kind) === section);

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

  return (
    <section className="overflow-hidden bg-white" data-testid="unified-quote-excel-grid">
      <div
        className="border-b border-slate-200 bg-slate-50 px-2 py-1 text-[9px] text-slate-500"
        data-testid="quote-grid-help"
      >
        Tab→ ／ Enter↓ ／ Shift+Enter↑ ｜ 黄色＝入力 ／ グレー＝参照
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
                        <button
                          type="button"
                          className="text-[9px] font-semibold underline underline-offset-2"
                          onClick={() => onAdd(section.key)}
                        >
                          {section.key === 'installation' ? '＋自由明細' : '＋行追加'}
                        </button>
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
                          <Input
                            value={row.name}
                            disabled={row.locked}
                            data-quote-grid-col="name"
                            onKeyDown={handleGridKeyDown}
                            onChange={(event) => onUpdate(row.key, { name: event.target.value })}
                            className="h-5 min-h-5 min-w-0 border-0 bg-transparent px-1 text-[10px] shadow-none focus:ring-2 focus:ring-emerald-700/30"
                            aria-label={`品名 ${number}`}
                          />
                          {detailLabel && <span className="block truncate px-1 text-[9px] text-slate-500">{detailLabel}</span>}
                        </td>
                        <td className={`w-10 border-r border-slate-200 px-0.5 ${editCellClass}`}>
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={row.quantity}
                            disabled={row.locked}
                            data-quote-grid-col="quantity"
                            onKeyDown={handleGridKeyDown}
                            onChange={(event) => onUpdate(row.key, { quantity: Number(event.target.value) || 0 })}
                            className="h-5 min-h-5 w-full border-0 bg-transparent px-1 text-right text-[10px] shadow-none focus:ring-2 focus:ring-emerald-700/30"
                            aria-label={`数量 ${number}`}
                          />
                        </td>
                        <td className={`w-9 border-r border-slate-200 px-0.5 ${editCellClass}`}>
                          <Input
                            value={row.unit ?? ''}
                            disabled={row.locked}
                            data-quote-grid-col="unit"
                            onKeyDown={handleGridKeyDown}
                            onChange={(event) => onUpdate(row.key, { unit: event.target.value })}
                            className="h-5 min-h-5 w-full border-0 bg-transparent px-1 text-[10px] shadow-none focus:ring-2 focus:ring-emerald-700/30"
                            aria-label={`単位 ${number}`}
                          />
                        </td>
                        <td className="w-14 border-r border-slate-200 bg-slate-50 px-2 text-right text-slate-400" title="原価正本はQuote Draftへ未接続">—</td>
                        <td className="w-16 border-r border-slate-200 bg-slate-50 px-1 text-right text-slate-400" title="原価正本はQuote Draftへ未接続">—</td>
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
                        <td className="w-16 border-r border-slate-200 bg-slate-50 px-1 text-right text-slate-400" title="原価正本はQuote Draftへ未接続">—</td>
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
      <div className="flex justify-between gap-4 py-0.5"><span>原価合計</span><strong className="text-slate-400">—</strong></div>
      <div className="flex justify-between gap-4 py-0.5"><span>売価明細合計</span><strong>{formatYen(subtotalRaw)}</strong></div>
      <div className="flex justify-between gap-4 py-0.5"><span>経費</span><strong className="text-slate-400">未接続</strong></div>
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
      <div className="mt-1.5 flex justify-between gap-4 rounded bg-emerald-50 px-2 py-1.5"><span>粗利</span><strong className="text-slate-400">—</strong></div>
      <div className="flex justify-between gap-4 py-0.5"><span>粗利率</span><strong className="text-slate-400">—</strong></div>
    </section>
  );
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

      <div className="overflow-x-auto p-4">
        <table className="w-full min-w-[48rem] border-collapse text-xs">
          <thead>
            <tr className="border-y border-slate-300 bg-slate-50 text-slate-600">
              <th className="px-2 py-1.5 text-left">区分</th>
              <th className="px-2 py-1.5 text-left">品名</th>
              <th className="px-2 py-1.5 text-right">数量</th>
              <th className="px-2 py-1.5 text-left">単位</th>
              <th className="px-2 py-1.5 text-right">単価</th>
              <th className="px-2 py-1.5 text-right">金額</th>
              <th className="px-2 py-1.5 text-left">備考</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const section = SECTION_META.find((entry) => entry.key === sectionForKind(row.kind))?.label ?? 'オプション';
              const separate = row.unitPrice === 0 && row.remark?.trim() === '別途見積';
              return (
                <tr key={row.key} className="border-b border-slate-200">
                  <td className="px-2 py-1.5 font-semibold">{section}</td>
                  <td className="px-2 py-1.5">{row.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.quantity}</td>
                  <td className="px-2 py-1.5">{row.unit || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{separate ? '別途見積' : formatYen(row.unitPrice)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{separate ? '—' : formatYen(row.amount)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{row.remark || ''}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">明細はまだありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="ml-auto max-w-md space-y-1 border-t border-slate-200 px-5 py-4 text-sm">
        <div className="flex justify-between gap-4"><span>税抜小計</span><strong>{formatYen(subtotal)}</strong></div>
        <div className="flex justify-between gap-4"><span>値引き・調整額</span><strong>{formatYen(adjustment)}</strong></div>
        <div className="flex justify-between gap-4"><span>消費税</span><strong>{formatYen(tax)}</strong></div>
        <div className="flex justify-between gap-4 border-t border-slate-400 pt-2 text-lg"><span>税込合計</span><strong>{formatYen(total)}</strong></div>
      </div>
    </section>
  );
}
