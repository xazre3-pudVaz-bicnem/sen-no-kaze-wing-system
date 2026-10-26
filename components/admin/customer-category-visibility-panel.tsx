'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveCategoryAction } from '@/lib/actions/admin';
import { customerCategoryVisibilityFormData } from '@/lib/domain/category-customer-visibility';
import type { OptionCategory } from '@/lib/domain/types';

type VisibilityFilter = 'all' | 'visible' | 'hidden';

export function CustomerCategoryVisibilityPanel({ categories }: { categories: OptionCategory[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<VisibilityFilter>('all');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const isVisible = (category: OptionCategory) => overrides[category.id] ?? category.customer_visible;
  const draftVisible = (category: OptionCategory) => drafts[category.id] ?? isVisible(category);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ja-JP');
    return categories.filter((category) => {
      const visible = overrides[category.id] ?? category.customer_visible;
      if (filter === 'visible' && !visible) return false;
      if (filter === 'hidden' && visible) return false;
      return !term || [category.name, category.code, category.group_name].some(
        (value) => value.toLocaleLowerCase('ja-JP').includes(term)
      );
    });
  }, [categories, filter, overrides, search]);

  const visibleCount = categories.filter((category) => isVisible(category)).length;

  const saveVisibility = (category: OptionCategory, visible: boolean) => {
    if (pending) return;
    setNotice(null);
    setSavingId(category.id);
    const data = customerCategoryVisibilityFormData(category, visible);
    startTransition(async () => {
      try {
        const result = await saveCategoryAction({ ok: false }, data);
        if (!result.ok) {
          const firstFieldError = Object.values(result.fieldErrors ?? {}).flat().find(Boolean);
          throw new Error(result.error ?? firstFieldError ?? 'カテゴリー設定を保存できませんでした。');
        }
        setOverrides((current) => ({ ...current, [category.id]: visible }));
        setDrafts((current) => {
          const next = { ...current };
          delete next[category.id];
          return next;
        });
        setNotice({ error: false, text: category.name + ' のお客様画面表示を変更しました。' });
        router.refresh();
      } catch (error) {
        setNotice({
          error: true,
          text: error instanceof Error ? error.message : 'カテゴリー設定を保存できませんでした。',
        });
      } finally {
        setSavingId(null);
      }
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-line bg-white p-4 sm:p-5" aria-label="お客様向けカテゴリー表示設定">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">お客様の選択画面に表示するカテゴリー</h2>
        <p className="text-sm text-muted">
          チェックを外すと、お客様向けシミュレーターの商品選択欄に表示しません。
          商品台帳・本体マスター・標準見積の商品と金額の設定は変更しません。
        </p>
        <p className="text-xs text-muted">
          ここは全モデル共通の表示設定です。機種・仕様別の選択可否は本体仕様マトリクスで管理します。
          同じカテゴリー内の特定商品だけを非表示にする場合は、商品側のシミュレーター表示設定を使います。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-[14rem] flex-1 items-center gap-2 text-sm">
          <span className="shrink-0 font-medium">検索</span>
          <input
            className="min-w-0 flex-1 rounded-md border border-line px-3 py-2"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="カテゴリー名・分類・コード"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">表示</span>
          <select
            className="rounded-md border border-line bg-white px-3 py-2"
            value={filter}
            onChange={(event) => setFilter(event.target.value as VisibilityFilter)}
          >
            <option value="all">すべて</option>
            <option value="visible">お客様に表示</option>
            <option value="hidden">お客様に非表示</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted">
        全 {categories.length} カテゴリー：表示 {visibleCount} 件／非表示 {categories.length - visibleCount} 件
      </p>
      {notice && (
        <p role="status" className={notice.error ? 'text-sm text-red-700' : 'text-sm text-emerald-800'}>
          {notice.text}
        </p>
      )}
      <div className="max-h-[30rem] divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {filtered.map((category) => (
          <div key={category.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{category.name}</p>
              <p className="text-xs text-muted">
                {category.group_name} / {category.code}
                {category.status !== 'published' ? ' / 下書き' : ''}
                {category.is_required ? ' / 必須カテゴリー' : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draftVisible(category)}
                  disabled={pending}
                  onChange={(event) => setDrafts((current) => ({ ...current, [category.id]: event.target.checked }))}
                  aria-label={category.name + ' をお客様のシミュレーターに表示'}
                />
                <span>{draftVisible(category) ? '表示する' : '表示しない'}</span>
              </label>
              <button
                type="button"
                className="rounded-md border border-line px-3 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                disabled={pending || draftVisible(category) === isVisible(category)}
                onClick={() => saveVisibility(category, draftVisible(category))}
              >
                {savingId === category.id ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="px-4 py-5 text-sm text-muted">該当するカテゴリーはありません。</p>}
      </div>
      <p className="text-xs text-muted">
        チェックを変更した後、その行の「保存」で反映します。必須カテゴリーや標準構成の商品を非表示にする前に、
        シミュレーターの初期状態・見積金額・保存の動作を確認してください。
      </p>
    </section>
  );
}
