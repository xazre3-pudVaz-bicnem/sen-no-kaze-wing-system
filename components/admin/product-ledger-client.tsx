'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Ellipsis, LayoutGrid, List, Search, X } from 'lucide-react';
import { ProductDetail } from '@/components/simulator/product-detail';
import { SmartImage } from '@/components/ui/smart-image';
import { Badge, Input, Select } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';
import { needsProductAttention, optionMatchesLedgerFilters, productAttentionReasons, selectedOptionAfterFilter, type LedgerQuickFilter } from '@/lib/domain/product-ledger';
import { defaultVariantIdsFor, pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import type { BaseModel, OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';

type Props = { canEdit: boolean; categories: OptionCategory[]; options: ProductOption[]; models: BaseModel[]; variantsByOptionId: Record<string, { groups: OptionVariantGroup[]; choices: OptionVariantChoice[] }>; initiallySelectedId?: string };
const EMPTY_VARIANTS: { groups: OptionVariantGroup[]; choices: OptionVariantChoice[] } = { groups: [], choices: [] };
const dash = '—';
function Row({ label, value }: { label: string; value: React.ReactNode }) { return <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 border-b border-line py-2 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>; }
function date(value: string) { const d = new Date(value); return Number.isNaN(d.valueOf()) ? dash : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`; }

export function ProductLedgerClient({ canEdit, categories, options, models, variantsByOptionId, initiallySelectedId }: Props) {
  const [query, setQuery] = useState(''); const [searchOpen, setSearchOpen] = useState(false); const [categoryId, setCategoryId] = useState(''); const [status, setStatus] = useState(''); const [quick, setQuick] = useState<LedgerQuickFilter>('all'); const [viewMode, setViewMode] = useState<'list' | 'grid'>('list'); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(50); const [selectedId, setSelectedId] = useState<string | null>(initiallySelectedId ?? null); const [detailTab, setDetailTab] = useState<'customer' | 'admin'>('customer'); const [previewVariantIds, setPreviewVariantIds] = useState<string[]>([]);
  const dialogRef = useRef<HTMLElement | null>(null); const openerRef = useRef<HTMLElement | null>(null);
  const categoryMap = useMemo(() => new Map(categories.map((x) => [x.id, x])), [categories]);
  const modelMap = useMemo(() => new Map(models.map((x) => [x.id, x])), [models]);
  const filtered = useMemo(() => options.filter((o) => optionMatchesLedgerFilters(o, { query, categoryId, status, quick })).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [categoryId, options, query, quick, status]);
  /* eslint-disable react-hooks/set-state-in-effect -- フィルター外選択の解除と商品切替時のローカルプレビュー初期化に限定 */
  useEffect(() => setSelectedId((id) => selectedOptionAfterFilter(id, filtered.map((o) => o.id))), [filtered]);
  const selected = filtered.find((o) => o.id === selectedId); const category = selected && categoryMap.get(selected.category_id); const variants = selected ? variantsByOptionId[selected.id] ?? EMPTY_VARIANTS : EMPTY_VARIANTS;
  const preview = useMemo(() => {
    const groups = variants.groups.filter((group) => group.status === 'published');
    const choices = variants.choices.filter((choice) => choice.status === 'published');
    return { groups, choices, defaults: selected ? defaultVariantIdsFor(groups, choices, [selected.id]) : [] };
  }, [selected, variants]);
  useEffect(() => setPreviewVariantIds(preview.defaults), [preview.defaults]); // 選択中商品のみのローカル表示状態。保存はしない。
  /* eslint-enable react-hooks/set-state-in-effect */
  const closeDetail = useCallback(() => {
    setSelectedId(null);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, []);
  const openDetail = useCallback((id: string, opener: HTMLElement) => {
    openerRef.current = opener;
    setDetailTab('customer');
    setSelectedId(id);
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDetail();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[data-dialog-close]')?.focus());
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeDetail, selectedId]);
  const onPreviewVariantChange = (choiceId: string, groupId: string) => {
    setPreviewVariantIds((current) => pruneHiddenVariantChoices(preview.groups, preview.choices, [...current.filter((id) => preview.choices.find((choice) => choice.id === id)?.group_id !== groupId), choiceId]));
  };
  const visiblePreviewGroups = visibleVariantGroups(preview.groups, preview.choices, previewVariantIds);
  const categoryCounts = useMemo(() => {
    const base = options.filter((o) => optionMatchesLedgerFilters(o, { query, categoryId: '', status, quick }));
    const counts = new Map<string, number>();
    for (const option of base) counts.set(option.category_id, (counts.get(option.category_id) ?? 0) + 1);
    return counts;
  }, [options, query, quick, status]);
  const categoryTotal = Array.from(categoryCounts.values()).reduce((sum, count) => sum + count, 0);
  const publishedCount = useMemo(() => options.filter((option) => option.status === 'published').length, [options]);
  const draftCount = options.length - publishedCount;
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
  return <div className="space-y-5">
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
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="公開状態">
              <button type="button" role="tab" aria-selected={status === ''} onClick={() => { setStatus(''); setQuick('all'); setPage(1); }} className={'rounded-lg px-3 py-1.5 text-sm font-medium ' + (status === '' ? 'bg-forest/10 text-ink' : 'text-muted hover:bg-sand hover:text-ink')}>
                すべて <span className="ml-1 text-xs">{options.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={status === 'published'} onClick={() => { setStatus('published'); setQuick('all'); setPage(1); }} className={'rounded-lg px-3 py-1.5 text-sm font-medium ' + (status === 'published' ? 'bg-forest/10 text-ink' : 'text-muted hover:bg-sand hover:text-ink')}>
                公開中 <span className="ml-1 text-xs">{publishedCount}</span>
              </button>
              <button type="button" role="tab" aria-selected={status === 'draft'} onClick={() => { setStatus('draft'); setQuick('all'); setPage(1); }} className={'rounded-lg px-3 py-1.5 text-sm font-medium ' + (status === 'draft' ? 'bg-forest/10 text-ink' : 'text-muted hover:bg-sand hover:text-ink')}>
                下書き <span className="ml-1 text-xs">{draftCount}</span>
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-expanded={searchOpen} className={query ? 'btn-secondary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSearchOpen((open) => !open)}>
                <Search className="size-4" aria-hidden="true" /> 検索
              </button>
              <button type="button" className={quick === 'needs-attention' ? 'btn-secondary btn-sm bg-ivory' : 'btn-ghost btn-sm'} onClick={() => { setQuick(quick === 'needs-attention' ? 'all' : 'needs-attention'); setPage(1); }}>
                要確認のみ
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

          <nav className="px-3 py-2 sm:px-4" aria-label="商品カテゴリー">
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" onClick={() => { setCategoryId(''); setPage(1); }} className={'rounded-full px-2.5 py-1.5 text-xs whitespace-nowrap sm:text-sm ' + (categoryId === '' ? 'bg-forest text-white' : 'bg-sand text-ink-soft hover:bg-forest/10')}>
                すべて <span className="ml-1 text-[0.68rem] opacity-75">{categoryTotal}</span>
              </button>
              {categories.map((item) => <button key={item.id} type="button" onClick={() => { setCategoryId(item.id); setPage(1); }} className={'rounded-full px-2.5 py-1.5 text-xs whitespace-nowrap sm:text-sm ' + (categoryId === item.id ? 'bg-forest text-white' : 'bg-sand text-ink-soft hover:bg-forest/10')}>
                {item.name} <span className="ml-1 text-[0.68rem] opacity-75">{categoryCounts.get(item.id) ?? 0}</span>
              </button>)}
            </div>
          </nav>

          {searchOpen && <div className="border-t border-line px-3 py-2 sm:px-4" data-testid="ledger-collapsible-search">
            <div className="flex items-center gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">商品を検索</span>
                <Input autoFocus type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="商品名・メーカー・シリーズ・型番・商品番号で検索" className="w-full" />
              </label>
              {query && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => { setQuery(''); setPage(1); }}>クリア</button>}
            </div>
          </div>}
        </div>

        {viewMode === 'list' ? (
          <div data-testid="ledger-table-view">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[680px] table-fixed text-left text-sm">
                <thead className="bg-forest/5 text-xs text-muted">
                  <tr>
                    <th className="w-[36%] px-3 py-2.5">商品</th>
                    <th className="w-[23%] px-3 py-2.5">メーカー・型番</th>
                    <th className="w-[18%] px-3 py-2.5">カテゴリー</th>
                    <th className="w-[11%] px-3 py-2.5">状態</th>
                    <th className="w-[8%] px-3 py-2.5">更新</th>
                    <th className="w-[4%] px-2 py-2.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pageOptions.map((o) => {
                    const attention = productAttentionReasons(o).length > 0;
                    return <tr key={o.id} className={selectedId === o.id ? 'bg-ivory/55' : 'bg-white hover:bg-sand/25'} data-testid={'ledger-option-' + o.code}>
                      <td className="px-3 py-2">
                        <button type="button" aria-haspopup="dialog" className="flex w-full min-w-0 items-center gap-2.5 text-left" onClick={(event) => openDetail(o.id, event.currentTarget)}>
                          <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-sand/55 text-[0.62rem] text-muted">
                            {o.image_url ? <SmartImage src={o.image_url} alt="" fill sizes="44px" className="object-contain" /> : '画像なし'}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ink">{o.name}</span>
                            <span className="mt-0.5 block truncate text-[0.68rem] text-muted">{o.product_no || '商品番号未採番'}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="block truncate">{o.manufacturer || dash}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted">{o.model_no || '型番未設定'}</span>
                      </td>
                      <td className="truncate px-3 py-2">{categoryMap.get(o.category_id)?.name ?? dash}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={o.status === 'published' ? 'success' : 'neutral'}>{o.status === 'published' ? '公開中' : '下書き'}</Badge>
                          {attention && <Badge tone="warn">要確認</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{date(o.updated_at)}</td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" aria-haspopup="dialog" aria-label={o.name + 'の詳細を表示'} title="詳細を表示" className="inline-flex size-8 items-center justify-center rounded-full border border-line bg-white text-ink-soft hover:bg-sand" onClick={(event) => openDetail(o.id, event.currentTarget)}>
                          <Ellipsis className="size-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 p-3 md:hidden">
              {pageOptions.map((o) => {
                const attention = productAttentionReasons(o).length > 0;
                return <article key={o.id} className="relative overflow-hidden rounded-xl border border-line bg-white" data-testid={'ledger-mobile-option-' + o.code}>
                  <button type="button" aria-haspopup="dialog" aria-label={o.name + 'の商品詳細を表示'} className="absolute inset-0 z-10" onClick={(event) => openDetail(o.id, event.currentTarget)}><span className="sr-only">{o.name}の商品詳細を表示</span></button>
                  <div className="pointer-events-none relative z-20 flex gap-3 p-3">
                    <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-sand/55 text-[0.6rem] text-muted">
                      {o.image_url ? <SmartImage src={o.image_url} alt="" fill sizes="48px" className="object-contain" /> : '画像なし'}
                    </span>
                    <div className="min-w-0 flex-1 pr-7">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[0.68rem] text-muted">{o.manufacturer || 'メーカー未設定'}</span>
                        <Badge tone={o.status === 'published' ? 'success' : 'neutral'}>{o.status === 'published' ? '公開中' : '下書き'}</Badge>
                        {attention && <Badge tone="warn">要確認</Badge>}
                      </div>
                      <h3 className="mt-1 truncate text-sm font-semibold">{o.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted">{[o.product_no, o.model_no].filter(Boolean).join(' ／ ') || dash}</p>
                    </div>
                    <ChevronRight className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  </div>
                </article>;
              })}
            </div>
          </div>
        ) : (
          <div className="p-3 sm:p-4" data-testid="ledger-grid-view">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 min-[1450px]:grid-cols-3">
              {pageOptions.map((o) => {
                const attentionReasons = productAttentionReasons(o);
                const attention = attentionReasons.length > 0;
                const itemCategory = categoryMap.get(o.category_id);
                const targetModel = o.base_model_id ? modelMap.get(o.base_model_id)?.name ?? '特定モデル' : '全モデル';
                return (
                  <article key={o.id} className={'group relative overflow-hidden rounded-xl border bg-white transition hover:border-ink/30 hover:shadow-soft ' + (selectedId === o.id ? 'border-brown bg-ivory/50 ring-1 ring-brown/20' : 'border-line')} data-testid={'ledger-option-' + o.code}>
                    <button type="button" aria-haspopup="dialog" aria-label={o.name + 'の商品詳細を表示'} className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown focus-visible:ring-inset" onClick={(event) => openDetail(o.id, event.currentTarget)}>
                      <span className="sr-only">{o.name}の商品詳細を表示</span>
                    </button>
                    <div className="pointer-events-none relative z-20 flex min-h-[6.75rem] gap-3 p-3">
                      <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-sand/55 text-[0.65rem] text-muted">
                        {o.image_url ? <SmartImage src={o.image_url} alt="" fill sizes="64px" className="object-contain" /> : '画像なし'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pr-10">
                          <span className="max-w-full truncate rounded-full bg-sand px-2 py-0.5 text-[0.65rem] font-medium text-ink-soft">{itemCategory?.name ?? 'カテゴリー未設定'}</span>
                          <Badge tone={o.status === 'published' ? 'success' : 'neutral'}>{o.status === 'published' ? '公開中' : '下書き'}</Badge>
                          {attention && <Badge tone="warn">要確認</Badge>}
                        </div>
                        <h3 className="mt-1.5 line-clamp-2 pr-8 text-sm font-semibold leading-snug text-ink">{o.name}</h3>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{[o.product_no, o.manufacturer, o.model_no].filter(Boolean).join(' ／ ') || dash}</p>
                        <p className="mt-1 text-[0.68rem] text-muted">{targetModel}</p>
                        {attention && <p className="mt-1 text-[0.68rem] font-medium text-warn" data-testid={'ledger-attention-reasons-' + o.code}>要確認：{attentionReasons.join('・')}</p>}
                      </div>
                      <button type="button" aria-haspopup="dialog" aria-label={o.name + 'の詳細を表示'} title="詳細を表示" className="pointer-events-auto absolute top-3 right-3 z-30 inline-flex size-8 items-center justify-center rounded-full border border-line bg-white text-ink-soft hover:bg-sand" onClick={(event) => openDetail(o.id, event.currentTarget)}>
                        <Ellipsis className="size-4" aria-hidden="true" />
                      </button>
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
    {selected && category && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/55 p-0 sm:p-4" data-testid="ledger-product-detail-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ledger-product-detail-title" className="relative flex h-full w-full flex-col overflow-hidden bg-sand/40 shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:max-w-5xl sm:rounded-2xl sm:border sm:border-line">
        <header className="border-b border-line bg-white/95 px-4 py-3 backdrop-blur sm:px-5">
          <div className="flex items-start gap-3">
            <span className="relative hidden size-14 shrink-0 overflow-hidden rounded-lg border border-line bg-sand sm:block">
              {selected.image_url ? <SmartImage src={selected.image_url} alt="" fill sizes="56px" className="object-contain" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.68rem] font-semibold tracking-wide text-brown">選択中の商品</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h2 id="ledger-product-detail-title" className="min-w-0 truncate text-lg font-semibold sm:text-xl">{selected.name}</h2>
                <Badge tone={selected.status === 'published' ? 'success' : 'neutral'}>{selected.status === 'published' ? '公開中' : '下書き'}</Badge>
                {needsProductAttention(selected) && <Badge tone="warn">要確認</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">{[selected.product_no, selected.manufacturer, selected.model_no].filter(Boolean).join(' ／ ') || dash}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canEdit && <Link href={`/admin/options/${selected.id}`} className="btn-primary btn-sm hidden sm:inline-flex">商品情報を編集</Link>}
              <button type="button" data-dialog-close aria-label="商品詳細を閉じる" title="閉じる" className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-white text-ink-soft hover:bg-sand" onClick={closeDetail}>
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
          {canEdit && <Link href={`/admin/options/${selected.id}`} className="btn-primary btn-sm mt-3 w-full sm:hidden">商品情報を編集</Link>}
        </header>

        <div className="grid shrink-0 grid-cols-2 border-b border-line bg-white px-4 pt-2 sm:px-5" role="tablist" aria-label="商品詳細の表示切替">
          <button type="button" role="tab" id="ledger-customer-tab" aria-controls="ledger-customer-panel" aria-selected={detailTab === 'customer'} onClick={() => setDetailTab('customer')} className={`border-b-2 px-3 py-2.5 text-sm font-semibold transition ${detailTab === 'customer' ? 'border-brown text-ink' : 'border-transparent text-muted hover:text-ink'}`}>お客様表示</button>
          <button type="button" role="tab" id="ledger-admin-tab" aria-controls="ledger-admin-panel" aria-selected={detailTab === 'admin'} onClick={() => setDetailTab('admin')} className={`border-b-2 px-3 py-2.5 text-sm font-semibold transition ${detailTab === 'admin' ? 'border-brown text-ink' : 'border-transparent text-muted hover:text-ink'}`}>管理情報</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {detailTab === 'customer' ? (
            <section id="ledger-customer-panel" role="tabpanel" aria-labelledby="ledger-customer-tab">
              <div className="mb-3 rounded-xl border border-brown/20 bg-ivory/70 px-3 py-2 text-xs text-ink-soft">
                シミュレーター画面と同じ商品詳細です。ここで変更した仕様は確認用で、保存されません。
              </div>
              <div className="card p-4 sm:p-5">
                <ProductDetail key={selected.id} category={category} option={selected} groups={visiblePreviewGroups} choices={preview.choices} selectedVariantIds={previewVariantIds} isCurrentlySelected={false} onVariantChange={onPreviewVariantChange} />
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
                  <Row label="シミュレーター対象" value={selected.preview_key || selected.affects_views.length ? '対象' : '対象外'}/>
                  <Row label="公開状態" value={selected.status === 'published' ? '公開' : '下書き・非公開'}/>
                  <Row label="商品価格（税別）" value={selected.price_on_request ? '別途見積' : formatYen(selected.price)}/>
                </dl>
              </div>

              <div className="card p-4">
                <h3 className="font-semibold">自社の仕入・発注情報</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">現在この商品詳細で取得できる正式な仕入先・発注コード・仕入原価・発注単位の保存項目はありません。未登録値を推測せず、取得可能になるまでは表示しません。</p>
              </div>

              <details className="card">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">利用状況 <ChevronDown className="size-4" /></summary>
                <p className="border-t border-line px-4 py-3 text-sm text-muted">標準見積の使用先は、この画面で取得できる既存データにはありません。</p>
              </details>
              <details className="card">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">登録・権限情報 <ChevronDown className="size-4" /></summary>
                <dl className="border-t border-line px-4">
                  <Row label="登録組織" value={selected.owner_id ? '登録者の組織' : '共通商品'}/>
                  <Row label="管理区分" value={selected.owner_id ? '登録者所有の商品' : '共通商品'}/>
                  <Row label="最終更新" value={date(selected.updated_at)}/>
                  <Row label="商品情報の編集権限" value={canEdit ? '現在の権限で編集可能' : '閲覧のみ（サーバー側認可に従います）'}/>
                </dl>
              </details>
            </section>
          )}
        </div>
      </section>
    </div>}
  </div>;
}
