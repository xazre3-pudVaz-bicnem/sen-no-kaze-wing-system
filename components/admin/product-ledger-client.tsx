'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Ellipsis } from 'lucide-react';
import { ProductDetail } from '@/components/simulator/product-detail';
import { SmartImage } from '@/components/ui/smart-image';
import { Badge, Input, Select } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';
import { needsProductAttention, optionMatchesLedgerFilters, selectedOptionAfterFilter, type LedgerQuickFilter } from '@/lib/domain/product-ledger';
import { defaultVariantIdsFor, pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';

type Props = { canEdit: boolean; categories: OptionCategory[]; options: ProductOption[]; variantsByOptionId: Record<string, { groups: OptionVariantGroup[]; choices: OptionVariantChoice[] }>; initiallySelectedId?: string };
const EMPTY_VARIANTS: { groups: OptionVariantGroup[]; choices: OptionVariantChoice[] } = { groups: [], choices: [] };
const dash = '—';
function Row({ label, value }: { label: string; value: React.ReactNode }) { return <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 border-b border-line py-2 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>; }
function date(value: string) { const d = new Date(value); return Number.isNaN(d.valueOf()) ? dash : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`; }

export function ProductLedgerClient({ canEdit, categories, options, variantsByOptionId, initiallySelectedId }: Props) {
  const [query, setQuery] = useState(''); const [categoryId, setCategoryId] = useState(''); const [status, setStatus] = useState(''); const [quick, setQuick] = useState<LedgerQuickFilter>('all'); const [sort, setSort] = useState('updated'); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(50); const [selectedId, setSelectedId] = useState<string | null>(initiallySelectedId ?? null); const [previewVariantIds, setPreviewVariantIds] = useState<string[]>([]);
  const categoryMap = useMemo(() => new Map(categories.map((x) => [x.id, x])), [categories]);
  const filtered = useMemo(() => options.filter((o) => optionMatchesLedgerFilters(o, { query, categoryId, status, quick })).sort((a, b) => sort === 'updated' ? b.updated_at.localeCompare(a.updated_at) : a.name.localeCompare(b.name, 'ja-JP')), [categoryId, options, query, quick, sort, status]);
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
  const onPreviewVariantChange = (choiceId: string, groupId: string) => {
    setPreviewVariantIds((current) => pruneHiddenVariantChoices(preview.groups, preview.choices, [...current.filter((id) => preview.choices.find((choice) => choice.id === id)?.group_id !== groupId), choiceId]));
  };
  const visiblePreviewGroups = visibleVariantGroups(preview.groups, preview.choices, previewVariantIds);
  const stateFilter = quick === 'needs-attention' ? 'needs-attention' : status || 'all';
  const categoryCounts = useMemo(() => {
    const base = options.filter((o) => optionMatchesLedgerFilters(o, { query, categoryId: '', status, quick }));
    const counts = new Map<string, number>();
    for (const option of base) counts.set(option.category_id, (counts.get(option.category_id) ?? 0) + 1);
    return counts;
  }, [options, query, quick, status]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageOptions = filtered.slice(pageStart, pageStart + pageSize);
  const firstShown = filtered.length ? pageStart + 1 : 0;
  const lastShown = Math.min(pageStart + pageSize, filtered.length);
  const resetFilters = () => { setQuery(''); setCategoryId(''); setStatus(''); setQuick('all'); setSort('updated'); setPage(1); };
  return <div className="space-y-5">
    <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-4 lg:block">
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">カテゴリー</p>
            <p className="mt-0.5 text-xs text-muted">商品を種類から絞り込み</p>
          </div>
          <nav className="max-h-[70vh] overflow-y-auto p-2" aria-label="商品カテゴリー">
            <button type="button" onClick={() => { setCategoryId(''); setPage(1); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${categoryId === '' ? 'bg-forest/10 font-semibold text-ink' : 'text-ink-soft hover:bg-sand'}`}>
              <span>すべて</span><span className="text-xs text-muted">{options.length}</span>
            </button>
            {categories.map((item) => <button key={item.id} type="button" onClick={() => { setCategoryId(item.id); setPage(1); }} className={`mt-0.5 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${categoryId === item.id ? 'bg-forest/10 font-semibold text-ink' : 'text-ink-soft hover:bg-sand'}`}>
              <span className="min-w-0 truncate">{item.name}</span><span className="ml-2 shrink-0 text-xs text-muted">{categoryCounts.get(item.id) ?? 0}</span>
            </button>)}
          </nav>
        </div>
      </aside>
      <section className="card min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-lg font-semibold">商品一覧</h2>
          <p className="mt-1 text-xs text-muted">商品名の下にメーカー・型番をまとめて表示します。行から商品詳細を開けます。</p>
        </div>
        <p className="text-xs text-muted">{filtered.length} / {options.length} 商品</p>
      </div>
      <div className="sticky top-0 z-20 grid gap-2 border-b border-line bg-white/95 p-3 shadow-sm backdrop-blur sm:grid-cols-[minmax(16rem,1fr)_minmax(10rem,.42fr)_minmax(9rem,.34fr)_minmax(11rem,.42fr)] lg:grid-cols-[minmax(16rem,1fr)_minmax(9rem,.34fr)_minmax(11rem,.42fr)_auto] sm:p-4">
        <label className="min-w-0">
          <span className="sr-only">商品を検索</span>
          <Input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="商品名・メーカー・型番を検索" className="w-full" />
        </label>
        <label className="min-w-0 lg:hidden">
          <span className="sr-only">カテゴリー</span>
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} className="w-full">
            <option value="">カテゴリー：すべて</option>
            {categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">状態</span>
          <Select
            value={stateFilter}
            onChange={(e) => {
              const value = e.target.value;
              setPage(1);
              if (value === 'needs-attention') { setStatus(''); setQuick('needs-attention'); return; }
              setQuick('all');
              setStatus(value === 'all' ? '' : value);
            }}
            className="w-full"
          >
            <option value="all">状態：すべて</option>
            <option value="published">公開中</option>
            <option value="draft">下書き</option>
            <option value="needs-attention">要確認</option>
          </Select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">並び替え</span>
          <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="w-full">
            <option value="updated">並び替え：更新が新しい順</option>
            <option value="name">並び替え：商品名順</option>
          </Select>
        </label>
        <button type="button" className="btn-ghost btn-sm hidden lg:inline-flex" onClick={resetFilters} disabled={!query && !categoryId && !status && quick === 'all' && sort === 'updated'}>条件をクリア</button>
      </div>
      <div className="overflow-x-auto lg:overflow-x-visible">
        <table className="w-full min-w-[54rem] table-fixed text-left text-sm">
          <thead className="bg-forest/5 text-xs text-muted lg:sticky lg:top-[4.55rem] lg:z-10">
            <tr>
              <th className="w-[43%] px-4 py-3">商品</th>
              <th className="w-[20%] px-4 py-3">カテゴリー</th>
              <th className="w-[14%] px-4 py-3 text-right">自社仕入原価</th>
              <th className="w-[8%] px-4 py-3">単位</th>
              <th className="w-[11%] px-4 py-3">状態</th>
              <th className="w-[4%] px-3 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pageOptions.map((o) => {
              const attention = needsProductAttention(o);
              return <tr key={o.id} className={selectedId === o.id ? 'bg-ivory/65' : 'bg-white hover:bg-sand/25'} data-testid={'ledger-option-' + o.code}>
                <td className="px-4 py-2.5">
                  <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setSelectedId(o.id)}>
                    <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-sand/55 text-[0.65rem] text-muted">
                      {o.image_url ? <SmartImage src={o.image_url} alt="" fill sizes="48px" className="object-contain" /> : '画像'}
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-semibold">{o.name}</span>
                        {attention && <Badge tone="warn">要確認</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{[o.manufacturer, o.model_no].filter(Boolean).join(' ／ ') || o.code}</span>
                    </span>
                  </button>
                </td>
                <td className="truncate px-4 py-2.5">{categoryMap.get(o.category_id)?.name ?? dash}</td>
                <td className="px-4 py-2.5 text-right text-muted">{dash}</td>
                <td className="px-4 py-2.5 text-muted">{dash}</td>
                <td className="px-4 py-2.5"><Badge tone={o.status === 'published' ? 'success' : 'neutral'}>{o.status === 'published' ? '公開中' : '下書き'}</Badge></td>
                <td className="px-3 py-2.5 text-right">
                  <button type="button" aria-label={o.name + 'の詳細を表示'} title="詳細を表示" className="inline-flex size-9 items-center justify-center rounded-full border border-line bg-white text-ink-soft hover:bg-sand" onClick={() => setSelectedId(o.id)}>
                    <Ellipsis className="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
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
    </div>
    {selected && category && <section className="space-y-5" data-testid="ledger-product-detail"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-brown">お客様への表示</p><h2 className="mt-1 text-xl font-semibold">シミュレーターと共通の表示</h2></div>{canEdit && <Link href={`/admin/options/${selected.id}`} className="btn-primary btn-sm">商品情報を編集</Link>}</div><div className="card p-4 sm:p-5"><p className="mb-3 text-xs text-muted">仕様の選択はこの画面内だけのプレビューです。保存はされません。</p><ProductDetail category={category} option={selected} groups={visiblePreviewGroups} choices={preview.choices} selectedVariantIds={previewVariantIds} isCurrentlySelected={false} onVariantChange={onPreviewVariantChange} /></div><div><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-brown">管理情報</p><h2 className="mt-1 text-xl font-semibold">商品・仕入れ情報</h2></div></div><div className="mt-3 grid gap-4 min-[900px]:grid-cols-2"><dl className="card p-4"><h3 className="mb-2 font-semibold">商品基本情報・カテゴリー固有仕様</h3><Row label="カテゴリー" value={category.name}/><Row label="メーカー" value={selected.manufacturer || dash}/><Row label="型番・品番" value={selected.model_no || '要設定'}/><Row label="サイズ・仕様" value={selected.size_note || dash}/><Row label="対象モデル" value={selected.base_model_id ? '特定モデル' : '全モデル共通'}/></dl><dl className="card p-4"><h3 className="mb-2 font-semibold">自社の仕入・発注情報</h3><Row label="自社仕入先" value={dash}/><Row label="自社発注コード" value={dash}/><Row label="自社仕入原価（税抜）" value={dash}/><Row label="発注単位" value={dash}/><Row label="施工・手配区分" value={selected.is_installation ? '設置関連費用として集計' : dash}/></dl></div><div className="mt-4 space-y-3"><details open={Boolean(selected.preview_key || selected.affects_views.length)} className="card"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">シミュレーター・Web表示設定 <ChevronDown className="size-4" /></summary><dl className="border-t border-line px-4"><Row label="シミュレーター対象" value={selected.preview_key || selected.affects_views.length ? '対象' : '対象外'}/><Row label="公開状態" value={selected.status === 'published' ? '公開' : '下書き・非公開'}/><Row label="商品価格（税別）" value={selected.price_on_request ? '別途見積' : formatYen(selected.price)}/></dl></details><details className="card"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">利用状況 <ChevronDown className="size-4" /></summary><p className="border-t border-line px-4 py-3 text-sm text-muted">標準見積の使用先は、この画面で取得できる既存データにはありません。</p></details><details className="card"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">登録・権限情報 <ChevronDown className="size-4" /></summary><dl className="border-t border-line px-4"><Row label="登録組織" value={selected.owner_id ? '登録者の組織' : '共通商品'}/><Row label="管理区分" value={selected.owner_id ? '登録者所有の商品' : '共通商品'}/><Row label="最終更新" value={date(selected.updated_at)}/><Row label="商品情報の編集権限" value={canEdit ? '現在の権限で編集可能' : '閲覧のみ（サーバー側認可に従います）'}/></dl></details></div></div></section>}
  </div>;
}
