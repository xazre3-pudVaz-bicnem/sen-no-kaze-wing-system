'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, List, Search, X } from 'lucide-react';
import { ProductDetail } from '@/components/simulator/product-detail';
import { SmartImage } from '@/components/ui/smart-image';
import { Badge, Input, Select } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';
import { needsProductAttention, optionMatchesLedgerFilters, selectedOptionAfterFilter } from '@/lib/domain/product-ledger';
import { defaultVariantIdsFor, pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import type { BaseModel, OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';

type Props = {
  canEdit: boolean;
  categories: OptionCategory[];
  options: ProductOption[];
  models: BaseModel[];
  variantsByOptionId: Record<string, { groups: OptionVariantGroup[]; choices: OptionVariantChoice[] }>;
  initiallySelectedId?: string;
};

type LedgerSort =
  | 'updated-desc'
  | 'updated-asc'
  | 'name-asc'
  | 'name-desc'
  | 'category-asc'
  | 'category-desc'
  | 'price-asc'
  | 'price-desc'
  | 'status-published-first'
  | 'status-draft-first';

type SortChoice = { value?: LedgerSort; label: string; disabled?: boolean };

const EMPTY_VARIANTS: { groups: OptionVariantGroup[]; choices: OptionVariantChoice[] } = { groups: [], choices: [] };
const dash = '—';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 border-b border-line py-2 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>;
}

function PendingDbValue() {
  return <span className="inline-flex items-center rounded-full border border-line bg-sand px-2 py-0.5 text-xs font-medium text-muted">接続待ち</span>;
}

function registrationStatusLabel(status: ProductOption['status']) {
  return status === 'published' ? '登録済み' : '下書き';
}

function date(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? dash : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function productPrice(option: ProductOption) {
  if (option.price_on_request) return '別途見積';
  if (!Number.isFinite(option.price)) return dash;
  return formatYen(option.price);
}

function priceSortKind(option: ProductOption) {
  if (option.price_on_request) return 1;
  if (!Number.isFinite(option.price)) return 2;
  return 0;
}

function compareOptions(a: ProductOption, b: ProductOption, sort: LedgerSort, categoryMap: Map<string, OptionCategory>) {
  const nameCompare = a.name.localeCompare(b.name, 'ja-JP', { numeric: true, sensitivity: 'base' });
  if (sort === 'name-asc') return nameCompare;
  if (sort === 'name-desc') return -nameCompare;
  if (sort === 'category-asc' || sort === 'category-desc') {
    const categoryCompare = (categoryMap.get(a.category_id)?.name ?? '').localeCompare(categoryMap.get(b.category_id)?.name ?? '', 'ja-JP', { numeric: true, sensitivity: 'base' });
    return (sort === 'category-asc' ? categoryCompare : -categoryCompare) || nameCompare;
  }
  if (sort === 'price-asc' || sort === 'price-desc') {
    const aKind = priceSortKind(a);
    const bKind = priceSortKind(b);
    if (aKind !== bKind) return aKind - bKind;
    if (aKind === 0) return (sort === 'price-asc' ? a.price - b.price : b.price - a.price) || nameCompare;
    return nameCompare;
  }
  if (sort === 'status-published-first' || sort === 'status-draft-first') {
    if (a.status !== b.status) {
      const publishedFirst = sort === 'status-published-first';
      return a.status === 'published' ? (publishedFirst ? -1 : 1) : (publishedFirst ? 1 : -1);
    }
    return nameCompare;
  }
  const updatedCompare = a.updated_at.localeCompare(b.updated_at);
  return (sort === 'updated-asc' ? updatedCompare : -updatedCompare) || nameCompare;
}

function SortHeader({ label, sort, choices, onSort, align = 'left' }: { label: string; sort: LedgerSort; choices: SortChoice[]; onSort: (value: LedgerSort) => void; align?: 'left' | 'right' }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !details.contains(target)) details.removeAttribute('open');
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.open) return;
      details.removeAttribute('open');
      details.querySelector<HTMLElement>('summary')?.focus();
    };
    const handleToggle = () => {
      if (!details.open) return;
      document.querySelectorAll<HTMLDetailsElement>('[data-ledger-sort-menu]').forEach((other) => {
        if (other !== details) other.removeAttribute('open');
      });
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    details.addEventListener('toggle', handleToggle);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      details.removeEventListener('toggle', handleToggle);
    };
  }, []);

  return (
    <details ref={detailsRef} data-ledger-sort-menu className="group relative inline-block">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded px-1 py-0.5 font-semibold text-ink-soft hover:bg-white/80 [&::-webkit-details-marker]:hidden" aria-label={label + 'の並び替え'}>
        <span>{label}</span>
        <ChevronDown className="size-3.5 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className={'absolute top-full z-40 mt-1 min-w-48 rounded-lg border border-line bg-white p-1.5 text-left text-xs font-normal shadow-lg ' + (align === 'right' ? 'right-0' : 'left-0')}>
        {choices.map((choice) => {
          const active = !!choice.value && choice.value === sort;
          return (
            <button
              key={choice.label}
              type="button"
              disabled={choice.disabled || !choice.value}
              aria-current={active ? 'true' : undefined}
              className={'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left ' + (choice.disabled || !choice.value ? 'cursor-not-allowed text-muted/60' : active ? 'bg-ivory font-semibold text-ink' : 'text-ink-soft hover:bg-sand')}
              onClick={(event) => {
                if (!choice.value) return;
                onSort(choice.value);
                event.currentTarget.closest('details')?.removeAttribute('open');
              }}
            >
              <span>{choice.label}</span>
              {active && <span aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
    </details>
  );
}

function ProductStatus({ status }: { status: ProductOption['status'] }) {
  return (
    <div className="flex flex-col items-start gap-1" data-simulator-standard-usage-slot="pending-db" data-product-handling-status-slot="pending-db">
      <Badge tone={status === 'published' ? 'success' : 'neutral'}>{registrationStatusLabel(status)}</Badge>
      {/* DB是正後、ここに「シミュレーター標準で使用中 ○件」を正式データから接続する。 */}
      {/* お客様選択可 / 取扱停止 / 本部判断で停止 / 廃番は、正式な判定データ接続後に必要なものだけ追加表示する。 */}
    </div>
  );
}

export function ProductLedgerClient({ canEdit, categories, options, models, variantsByOptionId, initiallySelectedId }: Props) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [groupCode, setGroupCode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sort, setSort] = useState<LedgerSort>('updated-desc');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedId, setSelectedId] = useState<string | null>(initiallySelectedId ?? null);
  const [detailTab, setDetailTab] = useState<'customer' | 'admin'>('customer');
  const [previewVariantIds, setPreviewVariantIds] = useState<string[]>([]);

  const categoryMap = useMemo(() => new Map(categories.map((x) => [x.id, x])), [categories]);
  const modelMap = useMemo(() => new Map(models.map((x) => [x.id, x])), [models]);
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, { code: string; name: string; sort: number; categories: OptionCategory[] }>();
    for (const category of categories) {
      const existing = groups.get(category.group_code);
      if (existing) {
        existing.categories.push(category);
        existing.sort = Math.min(existing.sort, category.group_sort);
      } else {
        groups.set(category.group_code, {
          code: category.group_code,
          name: category.group_name,
          sort: category.group_sort,
          categories: [category],
        });
      }
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        categories: [...group.categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja-JP')),
      }))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ja-JP'));
  }, [categories]);
  const selectedGroup = useMemo(() => categoryGroups.find((group) => group.code === groupCode) ?? null, [categoryGroups, groupCode]);
  const selectedGroupCategoryIds = useMemo(() => new Set(selectedGroup?.categories.map((category) => category.id) ?? []), [selectedGroup]);
  const filtered = useMemo(
    () =>
      options
        .filter((option) => (!groupCode || selectedGroupCategoryIds.has(option.category_id)) && optionMatchesLedgerFilters(option, { query, categoryId, status, quick: attentionOnly ? 'needs-attention' : 'all' }))
        .sort((a, b) => compareOptions(a, b, sort, categoryMap)),
    [attentionOnly, categoryId, categoryMap, groupCode, options, query, selectedGroupCategoryIds, sort, status]
  );

  /* eslint-disable react-hooks/set-state-in-effect -- フィルター外選択の解除と商品切替時のローカルプレビュー初期化に限定 */
  useEffect(() => setSelectedId((id) => selectedOptionAfterFilter(id, filtered.map((o) => o.id))), [filtered]);
  const selected = filtered.find((o) => o.id === selectedId);
  const category = selected && categoryMap.get(selected.category_id);
  const variants = selected ? variantsByOptionId[selected.id] ?? EMPTY_VARIANTS : EMPTY_VARIANTS;
  const preview = useMemo(() => {
    const groups = variants.groups.filter((group) => group.status === 'published');
    const choices = variants.choices.filter((choice) => choice.status === 'published');
    return { groups, choices, defaults: selected ? defaultVariantIdsFor(groups, choices, [selected.id]) : [] };
  }, [selected, variants]);
  useEffect(() => setPreviewVariantIds(preview.defaults), [preview.defaults]); // 選択中商品のみのローカル表示状態。保存はしない。
  /* eslint-enable react-hooks/set-state-in-effect */

  const closeDetail = useCallback(() => setSelectedId(null), []);
  const openDetail = useCallback((id: string) => {
    setDetailTab('customer');
    setSelectedId(id);
  }, []);

  useEffect(() => {
    if (!selectedId || window.matchMedia('(min-width: 1280px)').matches) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('ledger-product-detail-pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);

  const onPreviewVariantChange = (choiceId: string, groupId: string) => {
    setPreviewVariantIds((current) => pruneHiddenVariantChoices(preview.groups, preview.choices, [...current.filter((id) => preview.choices.find((choice) => choice.id === id)?.group_id !== groupId), choiceId]));
  };
  const visiblePreviewGroups = visibleVariantGroups(preview.groups, preview.choices, previewVariantIds);

  const categoryCounts = useMemo(() => {
    const base = options.filter((o) => optionMatchesLedgerFilters(o, { query, categoryId: '', status, quick: attentionOnly ? 'needs-attention' : 'all' }));
    const counts = new Map<string, number>();
    for (const option of base) counts.set(option.category_id, (counts.get(option.category_id) ?? 0) + 1);
    return counts;
  }, [attentionOnly, options, query, status]);
  const categoryTotal = Array.from(categoryCounts.values()).reduce((sum, count) => sum + count, 0);
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of categoryGroups) {
      counts.set(group.code, group.categories.reduce((sum, item) => sum + (categoryCounts.get(item.id) ?? 0), 0));
    }
    return counts;
  }, [categoryCounts, categoryGroups]);

  const registeredCount = useMemo(() => options.filter((option) => option.status === 'published').length, [options]);
  const draftCount = options.length - registeredCount;
  const attentionCount = useMemo(() => options.filter(needsProductAttention).length, [options]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageOptions = filtered.slice(pageStart, pageStart + pageSize);
  const firstShown = filtered.length ? pageStart + 1 : 0;
  const lastShown = Math.min(pageStart + pageSize, filtered.length);
  const selectedIndex = selected ? filtered.findIndex((option) => option.id === selected.id) : -1;

  const selectAt = (index: number) => {
    const option = filtered[index];
    if (!option) return;
    setPage(Math.floor(index / pageSize) + 1);
    setSelectedId(option.id);
  };

  const applySort = (value: LedgerSort) => {
    setSort(value);
    setPage(1);
  };

  return <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(26rem,0.65fr)] xl:items-start">
      <section className="card min-w-0 overflow-visible">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-lg font-semibold">商品一覧</h2>
            <p className="mt-1 text-xs text-muted">探す・比較する・状態を確認するための一覧です。商品を開いて詳細を確認できます。</p>
          </div>
          <p className="text-xs font-medium text-muted">
            {filtered.length ? filtered.length + '件中 ' + firstShown + '〜' + lastShown + '件を表示' : '0件'}
          </p>
        </div>

        <div className="sticky top-0 z-30 border-b border-line bg-white/95 shadow-sm backdrop-blur" data-testid="ledger-sticky-category-bar">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 sm:px-4">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="登録状態">
              <button type="button" role="tab" aria-selected={status === '' && !attentionOnly} onClick={() => { setStatus(''); setAttentionOnly(false); setPage(1); }} className={'rounded-lg px-3 py-1.5 text-sm font-medium ' + (status === '' && !attentionOnly ? 'bg-forest/10 text-ink' : 'text-muted hover:bg-sand hover:text-ink')}>
                すべて <span className="ml-1 text-xs">{options.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={status === 'published' && !attentionOnly} onClick={() => { setStatus('published'); setAttentionOnly(false); setPage(1); }} className={'rounded-lg px-3 py-1.5 text-sm font-medium ' + (status === 'published' && !attentionOnly ? 'bg-forest/10 text-ink' : 'text-muted hover:bg-sand hover:text-ink')}>
                登録済み <span className="ml-1 text-xs">{registeredCount}</span>
              </button>
              <button type="button" role="tab" aria-selected={status === 'draft' && !attentionOnly} onClick={() => { setStatus('draft'); setAttentionOnly(false); setPage(1); }} className={'rounded-lg px-3 py-1.5 text-sm font-medium ' + (status === 'draft' && !attentionOnly ? 'bg-forest/10 text-ink' : 'text-muted hover:bg-sand hover:text-ink')}>
                下書き <span className="ml-1 text-xs">{draftCount}</span>
              </button>
              <button type="button" role="tab" aria-selected={attentionOnly} onClick={() => { setStatus(''); setAttentionOnly(true); setPage(1); }} className={'rounded-lg px-3 py-1.5 text-sm font-medium ' + (attentionOnly ? 'bg-amber-100 text-amber-900' : 'text-muted hover:bg-amber-50 hover:text-ink')}>
                要確認 <span className="ml-1 text-xs">{attentionCount}</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button type="button" aria-expanded={searchOpen} className={query ? 'btn-secondary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSearchOpen((open) => !open)}>
                <Search className="size-4" aria-hidden="true" /> 検索
              </button>
              <div className="flex rounded-lg border border-line bg-white p-0.5" aria-label="表示形式">
                <button type="button" aria-pressed={viewMode === 'list'} title="一覧表示" onClick={() => setViewMode('list')} className={'inline-flex size-8 items-center justify-center rounded-md ' + (viewMode === 'list' ? 'bg-forest/10 text-ink' : 'text-muted hover:bg-sand')}>
                  <List className="size-4" aria-hidden="true" />
                  <span className="sr-only">一覧表示</span>
                </button>
                <button type="button" aria-pressed={viewMode === 'grid'} title="画像表示" onClick={() => setViewMode('grid')} className={'inline-flex size-8 items-center justify-center rounded-md ' + (viewMode === 'grid' ? 'bg-forest/10 text-ink' : 'text-muted hover:bg-sand')}>
                  <LayoutGrid className="size-4" aria-hidden="true" />
                  <span className="sr-only">画像表示</span>
                </button>
              </div>
            </div>
          </div>

          <div data-testid="ledger-category-groups">
            <nav className="px-3 py-2 sm:px-4" aria-label="商品分類">
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => { setGroupCode(''); setCategoryId(''); setPage(1); }} className={'rounded-full px-3 py-1.5 text-xs whitespace-nowrap sm:text-sm ' + (groupCode === '' ? 'bg-forest text-white' : 'bg-sand text-ink-soft hover:bg-forest/10')}>
                  すべて <span className="ml-1 text-[0.68rem] opacity-75">{categoryTotal}</span>
                </button>
                {categoryGroups.map((group) => <button key={group.code} type="button" onClick={() => { setGroupCode(group.code); setCategoryId(''); setPage(1); }} className={'rounded-full px-3 py-1.5 text-xs whitespace-nowrap sm:text-sm ' + (groupCode === group.code ? 'bg-forest text-white' : 'bg-sand text-ink-soft hover:bg-forest/10')}>
                  {group.name} <span className="ml-1 text-[0.68rem] opacity-75">{groupCounts.get(group.code) ?? 0}</span>
                </button>)}
              </div>
            </nav>

            {selectedGroup && (
              <nav className="border-t border-line bg-sand/25 px-3 py-2 sm:px-4" aria-label={selectedGroup.name + 'のカテゴリー'} data-testid="ledger-category-children">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[0.68rem] font-semibold text-muted">{selectedGroup.name}</span>
                  <button type="button" onClick={() => { setCategoryId(''); setPage(1); }} className={'rounded-lg px-2.5 py-1 text-xs whitespace-nowrap ' + (categoryId === '' ? 'bg-white font-semibold text-ink shadow-sm ring-1 ring-line' : 'text-ink-soft hover:bg-white')}>
                    すべて <span className="ml-1 text-[0.65rem] text-muted">{groupCounts.get(selectedGroup.code) ?? 0}</span>
                  </button>
                  {selectedGroup.categories.map((item) => <button key={item.id} type="button" onClick={() => { setCategoryId(item.id); setPage(1); }} className={'rounded-lg px-2.5 py-1 text-xs whitespace-nowrap ' + (categoryId === item.id ? 'bg-white font-semibold text-ink shadow-sm ring-1 ring-line' : 'text-ink-soft hover:bg-white')}>
                    {item.name} <span className="ml-1 text-[0.65rem] text-muted">{categoryCounts.get(item.id) ?? 0}</span>
                  </button>)}
                </div>
              </nav>
            )}
          </div>

          {searchOpen && <div className="border-t border-line px-3 py-2 sm:px-4" data-testid="ledger-collapsible-search">
            <div className="flex items-center gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">商品を検索</span>
                <Input autoFocus type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="商品名・メーカー・シリーズ・型番で検索" className="w-full" />
              </label>
              {query && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => { setQuery(''); setPage(1); }}>クリア</button>}
            </div>
          </div>}
        </div>

        {viewMode === 'list' ? (
          <div data-testid="ledger-table-view">
            <div className="hidden md:block">
              <table className="w-full table-fixed text-left text-[0.8125rem]">
                <thead className="bg-forest/5 text-[0.72rem] text-muted">
                  <tr>
                    <th className="w-[40%] px-2.5 py-1.5">
                      <SortHeader label="商品" sort={sort} onSort={applySort} choices={[{ value: 'name-asc', label: '商品名 昇順' }, { value: 'name-desc', label: '商品名 降順' }]} />
                    </th>
                    <th className="w-[16%] px-2.5 py-1.5">
                      <SortHeader label="カテゴリー" sort={sort} onSort={applySort} choices={[{ value: 'category-asc', label: 'カテゴリー 昇順' }, { value: 'category-desc', label: 'カテゴリー 降順' }]} />
                    </th>
                    <th className="w-[17%] px-2.5 py-1.5 text-right">
                      <SortHeader label="商品価格（税別）" sort={sort} onSort={applySort} align="right" choices={[{ value: 'price-asc', label: '安い順' }, { value: 'price-desc', label: '高い順' }]} />
                    </th>
                    <th className="w-[15%] px-2.5 py-1.5">
                      <SortHeader label="状態" sort={sort} onSort={applySort} choices={[{ value: 'status-published-first', label: '登録済みを先に表示' }, { value: 'status-draft-first', label: '下書きを先に表示' }, { label: '標準使用数が多い順（接続待ち）', disabled: true }]} />
                    </th>
                    <th className="w-[12%] px-2.5 py-1.5">
                      <SortHeader label="更新日" sort={sort} onSort={applySort} align="right" choices={[{ value: 'updated-desc', label: '新しい順' }, { value: 'updated-asc', label: '古い順' }]} />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pageOptions.map((o) => {
                    const itemCategory = categoryMap.get(o.category_id);
                    const manufacturerModel = [o.manufacturer, o.model_no].filter(Boolean).join(' ／ ') || dash;
                    return <tr
                      key={o.id}
                      tabIndex={0}
                      aria-selected={selectedId === o.id}
                      onClick={() => openDetail(o.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openDetail(o.id);
                        }
                      }}
                      className={(selectedId === o.id ? 'bg-ivory/55' : 'bg-white hover:bg-sand/25') + ' cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brown/50'}
                      data-testid={'ledger-option-' + o.code}
                    >
                      <td className="px-2.5 py-1.5">
                        <div className="flex w-full min-w-0 items-center gap-2.5 text-left">
                          <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-sand/55 text-[0.62rem] text-muted">
                            {o.image_url ? <SmartImage src={o.image_url} alt="" fill sizes="44px" className="object-contain" /> : '画像なし'}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block line-clamp-2 text-[0.92rem] font-semibold leading-tight text-ink">{o.name}</span>
                            <span className="mt-0.5 block truncate text-xs leading-tight text-muted">{manufacturerModel}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5 text-xs font-medium text-ink-soft">{itemCategory?.name ?? dash}</td>
                      <td className="px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums text-ink">{productPrice(o)}</td>
                      <td className="px-2.5 py-1.5"><ProductStatus status={o.status} /></td>
                      <td className="px-2.5 py-1.5 text-xs whitespace-nowrap text-muted">{date(o.updated_at)}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 p-3 md:hidden">
              {pageOptions.map((o) => {
                const itemCategory = categoryMap.get(o.category_id);
                return <article key={o.id} className="relative overflow-hidden rounded-xl border border-line bg-white" data-testid={'ledger-mobile-option-' + o.code}>
                  <button type="button" aria-controls="ledger-product-detail-pane" aria-label={o.name + 'の商品詳細を表示'} className="absolute inset-0 z-10" onClick={() => openDetail(o.id)}><span className="sr-only">{o.name}の商品詳細を表示</span></button>
                  <div className="pointer-events-none relative z-20 flex gap-2.5 p-2.5">
                    <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-sand/55 text-[0.6rem] text-muted">
                      {o.image_url ? <SmartImage src={o.image_url} alt="" fill sizes="44px" className="object-contain" /> : '画像なし'}
                    </span>
                    <div className="min-w-0 flex-1 pr-6">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="max-w-full truncate rounded-full bg-sand px-1.5 py-0.5 text-[0.62rem] font-medium text-ink-soft">{itemCategory?.name ?? 'カテゴリー未設定'}</span>
                        <ProductStatus status={o.status} />
                      </div>
                      <h3 className="mt-1 line-clamp-2 text-[0.92rem] font-semibold leading-tight">{o.name}</h3>
                      <p className="mt-0.5 truncate text-xs leading-tight text-muted">{[o.manufacturer, o.model_no].filter(Boolean).join(' ／ ') || dash}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-ink">{productPrice(o)}</span>
                        <span className="text-muted">更新 {date(o.updated_at)}</span>
                      </div>
                    </div>
                    <ChevronRight className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  </div>
                </article>;
              })}
            </div>
          </div>
        ) : (
          <div className="p-3 sm:p-4" data-testid="ledger-grid-view">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 min-[1450px]:grid-cols-3">
              {pageOptions.map((o) => {
                const itemCategory = categoryMap.get(o.category_id);
                const targetModel = o.base_model_id ? modelMap.get(o.base_model_id)?.name ?? '特定モデル' : '全モデル';
                return (
                  <article key={o.id} className={'group relative overflow-hidden rounded-xl border bg-white transition hover:border-ink/30 hover:shadow-soft ' + (selectedId === o.id ? 'border-brown bg-ivory/50 ring-1 ring-brown/20' : 'border-line')} data-testid={'ledger-option-' + o.code}>
                    <button type="button" aria-controls="ledger-product-detail-pane" aria-label={o.name + 'の商品詳細を表示'} className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown focus-visible:ring-inset" onClick={() => openDetail(o.id)}>
                      <span className="sr-only">{o.name}の商品詳細を表示</span>
                    </button>
                    <div className="pointer-events-none relative z-20 flex min-h-[6.25rem] gap-2.5 p-2.5">
                      <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-sand/55 text-[0.65rem] text-muted">
                        {o.image_url ? <SmartImage src={o.image_url} alt="" fill sizes="64px" className="object-contain" /> : '画像なし'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="max-w-full truncate rounded-full bg-sand px-1.5 py-0.5 text-[0.62rem] font-medium text-ink-soft">{itemCategory?.name ?? 'カテゴリー未設定'}</span>
                          <ProductStatus status={o.status} />
                        </div>
                        <h3 className="mt-1 line-clamp-2 text-[0.92rem] font-semibold leading-snug text-ink">{o.name}</h3>
                        <p className="mt-0.5 line-clamp-1 text-xs leading-tight text-muted">{[o.manufacturer, o.model_no].filter(Boolean).join(' ／ ') || dash}</p>
                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-ink">{productPrice(o)}</p>
                          <p className="text-[0.68rem] text-muted">{targetModel}</p>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {!filtered.length && <p className="px-5 py-10 text-center text-sm text-muted">条件に一致する商品がありません。</p>}
        {!!filtered.length && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          <p className="text-xs text-muted">{filtered.length}件中 {firstShown}〜{lastShown}件を表示</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              <span>表示件数</span>
              <Select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-9 w-24">
                <option value="25">25件</option>
                <option value="50">50件</option>
                <option value="100">100件</option>
              </Select>
            </label>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}>前へ</button>
            <span className="min-w-16 text-center text-xs font-semibold">{currentPage} / {totalPages}</span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}>次へ</button>
          </div>
        </div>}
      </section>

      {selected && category ? <section id="ledger-product-detail-pane" aria-labelledby="ledger-product-detail-title" className="card min-w-0 overflow-hidden bg-sand/40 xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100dvh-2rem)] xl:flex-col" data-testid="ledger-product-detail-pane">
        <header className="border-b border-line bg-white/95 px-4 py-3 backdrop-blur sm:px-5">
          <div className="flex items-start gap-3">
            <span className="relative hidden size-14 shrink-0 overflow-hidden rounded-lg border border-line bg-sand sm:block">
              {selected.image_url ? <SmartImage src={selected.image_url} alt="" fill sizes="56px" className="object-contain" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.68rem] font-semibold tracking-wide text-brown">選択中の商品</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h2 id="ledger-product-detail-title" className="min-w-0 truncate text-lg font-semibold sm:text-xl">{selected.name}</h2>
                <Badge tone={selected.status === 'published' ? 'success' : 'neutral'}>{registrationStatusLabel(selected.status)}</Badge>
                {needsProductAttention(selected) && <Badge tone="warn">要確認</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">{[selected.product_no, selected.manufacturer, selected.model_no].filter(Boolean).join(' ／ ') || dash}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canEdit && <Link href={`/admin/options/${selected.id}?return_to=%2Fadmin%2Fledger`} className="btn-primary btn-sm hidden sm:inline-flex">商品情報を編集</Link>}
              <button type="button" aria-label="商品詳細を閉じる" title="閉じる" className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-white text-ink-soft hover:bg-sand" onClick={closeDetail}>
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
            <button type="button" className="btn-secondary btn-sm" disabled={selectedIndex <= 0} onClick={() => selectAt(selectedIndex - 1)}>
              <ChevronLeft className="size-4" aria-hidden="true" /> 前の商品
            </button>
            <p className="text-xs text-muted">{selectedIndex + 1} / {filtered.length}</p>
            <button type="button" className="btn-secondary btn-sm" disabled={selectedIndex < 0 || selectedIndex >= filtered.length - 1} onClick={() => selectAt(selectedIndex + 1)}>
              次の商品 <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
          {canEdit && <Link href={`/admin/options/${selected.id}?return_to=%2Fadmin%2Fledger`} className="btn-primary btn-sm mt-3 w-full sm:hidden">商品情報を編集</Link>}
        </header>

        <div className="grid shrink-0 grid-cols-2 border-b border-line bg-white px-4 pt-2 sm:px-5" role="tablist" aria-label="商品詳細の表示切替">
          <button type="button" role="tab" id="ledger-customer-tab" aria-controls="ledger-customer-panel" aria-selected={detailTab === 'customer'} onClick={() => setDetailTab('customer')} className={`border-b-2 px-3 py-2.5 text-sm font-semibold transition ${detailTab === 'customer' ? 'border-brown text-ink' : 'border-transparent text-muted hover:text-ink'}`}>お客様表示</button>
          <button type="button" role="tab" id="ledger-admin-tab" aria-controls="ledger-admin-panel" aria-selected={detailTab === 'admin'} onClick={() => setDetailTab('admin')} className={`border-b-2 px-3 py-2.5 text-sm font-semibold transition ${detailTab === 'admin' ? 'border-brown text-ink' : 'border-transparent text-muted hover:text-ink'}`}>管理情報</button>
        </div>

        <div className="p-4 sm:p-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          {detailTab === 'customer' ? (
            <section id="ledger-customer-panel" role="tabpanel" aria-labelledby="ledger-customer-tab">
              <div className="mb-3 rounded-xl border border-brown/20 bg-ivory/70 px-3 py-2 text-xs text-ink-soft">
                シミュレーター画面と同じ商品詳細です。ここで変更した仕様は確認用で、保存されません。
              </div>
              <div className="card p-4 sm:p-5">
                <ProductDetail key={selected.id} category={category} option={selected} groups={visiblePreviewGroups} choices={preview.choices} selectedVariantIds={previewVariantIds} isCurrentlySelected={false} compactMedia onVariantChange={onPreviewVariantChange} />
              </div>
            </section>
          ) : (
            <section id="ledger-admin-panel" role="tabpanel" aria-labelledby="ledger-admin-tab" className="space-y-4">
              <div className="grid gap-4 min-[900px]:grid-cols-2">
                <dl className="card p-4">
                  <h3 className="mb-2 font-semibold">商品基本情報</h3>
                  <Row label="商品管理番号" value={selected.product_no || '未採番'}/>
                  <Row label="カテゴリー" value={category.name}/>
                  <Row label="メーカー" value={selected.manufacturer || dash}/>
                  <Row label="型番・品番" value={selected.model_no || '要設定'}/>
                  <Row label="サイズ・仕様" value={selected.size_note || dash}/>
                  <Row label="対象モデル" value={selected.base_model_id ? modelMap.get(selected.base_model_id)?.name ?? '特定モデル' : '全モデル共通'}/>
                  <Row label="施工・手配区分" value={selected.is_installation ? '設置関連費用として集計' : dash}/>
                </dl>
                <dl className="card p-4">
                  <h3 className="mb-2 font-semibold">シミュレーター・Web表示設定</h3>
                  <p className="mb-2 text-xs leading-relaxed text-muted">お客様が選べるかどうかは、登録元・登録状態・取扱状況・本体分類表・モデル／仕様適合などを正式ロジックで判定するため、現在の画面値から推測しません。</p>
                  <Row label="商品価格（税別）" value={productPrice(selected)}/>
                </dl>
              </div>

              <section className="card p-4" data-product-handling-status-shell="pending-db" aria-labelledby="ledger-handling-status-title">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 id="ledger-handling-status-title" className="font-semibold">取扱状況</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">登録状態とは別に、自組織・本部判断・メーカー状況を独立して確認します。現在は正式な保存項目への接続待ちです。</p>
                  </div>
                  <PendingDbValue />
                </div>
                <dl className="mt-2">
                  <Row label="自組織の取扱" value={<PendingDbValue />}/>
                  <Row label="本部判断" value={<PendingDbValue />}/>
                  <Row label="メーカー状況" value={<PendingDbValue />}/>
                </dl>
                <div className="mt-3 border-t border-line pt-3">
                  <p className="text-xs font-semibold text-ink-soft">将来の操作位置</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">保存契約・権限判定を接続するまでは操作できません。client側だけで状態を保存しません。</p>
                  <div className="mt-2 flex flex-wrap gap-2" aria-label="取扱状況の操作（接続待ち）">
                    <button type="button" className="btn-secondary btn-sm" disabled>取扱停止にする</button>
                    <button type="button" className="btn-secondary btn-sm" disabled>取扱再開</button>
                    <button type="button" className="btn-secondary btn-sm" disabled>本部判断で停止</button>
                    <button type="button" className="btn-secondary btn-sm" disabled>本部判断による停止を解除</button>
                    <button type="button" className="btn-secondary btn-sm" disabled>廃番にする</button>
                    <button type="button" className="btn-secondary btn-sm" disabled>廃番訂正</button>
                  </div>
                </div>
              </section>

              <section className="card p-4" data-customer-simulator-status-shell="pending-db" aria-labelledby="ledger-customer-simulator-title">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 id="ledger-customer-simulator-title" className="font-semibold">お客様のシミュレーター</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">「お客様選択」と「シミュレーター標準での使用状況」は別の情報です。選択可否は正式ロジック接続後に判定します。</p>
                  </div>
                  <PendingDbValue />
                </div>
                <dl className="mt-2">
                  <Row label="お客様選択" value={<PendingDbValue />}/>
                  <Row
                    label="対象モデル・仕様"
                    value={`${selected.base_model_id ? modelMap.get(selected.base_model_id)?.name ?? '特定モデル' : '全モデル共通'} ／ ${selected.spec_codes.length ? selected.spec_codes.join(' / ') : '全仕様共通'}`}
                  />
                  <Row label="シミュレーター標準での使用状況" value={<PendingDbValue />}/>
                </dl>
                <p className="mt-2 border-t border-line pt-3 text-xs leading-relaxed text-muted">対象モデル・仕様は商品に保存済みの設定値を表示しています。実際にお客様が選択できるかどうかは、本体分類表などを含む正式判定とは別です。</p>
              </section>

              <div className="card p-4">
                <h3 className="font-semibold">自社の仕入・発注情報</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">現在この商品詳細で取得できる正式な仕入先・発注コード・仕入原価・発注単位の保存項目はありません。未登録値を推測せず、取得可能になるまでは表示しません。</p>
              </div>

              <details className="card">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">利用状況 <ChevronDown className="size-4" /></summary>
                <p className="border-t border-line px-4 py-3 text-sm text-muted">標準見積の使用先は、この画面で取得できる既存データにはありません。</p>
              </details>
              <details className="card" data-product-origin-slot="pending-db">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">登録・権限情報 <ChevronDown className="size-4" /></summary>
                <div className="border-t border-line">
                  <p className="px-4 pt-3 text-xs leading-relaxed text-muted">商品区分・登録元組織は組織情報の接続後に表示します。現在の値からは推測しません。</p>
                  <dl className="px-4">
                    <Row label="登録状態" value={registrationStatusLabel(selected.status)}/>
                    <Row label="商品区分" value={<PendingDbValue />}/>
                    <Row label="登録元組織" value={<PendingDbValue />}/>
                    <Row label="最終更新" value={date(selected.updated_at)}/>
                    <Row label="商品情報の編集権限" value={canEdit ? '現在の権限で編集可能' : '閲覧のみ（サーバー側認可に従います）'}/>
                  </dl>
                </div>
              </details>
            </section>
          )}
        </div>
      </section> : <aside id="ledger-product-detail-pane" aria-label="商品詳細" className="card hidden min-h-[18rem] items-center justify-center border-dashed p-6 text-center xl:flex" data-testid="ledger-product-detail-empty">
        <div className="max-w-xs">
          <p className="font-semibold text-ink">商品を選択してください</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">一覧から商品を選択すると、ここに詳細を表示します。</p>
        </div>
      </aside>}
  </div>;
}