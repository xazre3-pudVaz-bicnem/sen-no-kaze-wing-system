import Link from 'next/link';
import { getStore } from '@/lib/data/store';
import { AdminPage } from '@/components/admin/ui';
import { CategoryForm } from '@/components/admin/forms';
import { CustomerCategoryVisibilityPanel } from '@/components/admin/customer-category-visibility-panel';
import { LEGACY_FIRE_SPEC_CATEGORY_CODE } from '@/lib/domain/types';

type SearchParams = { edit?: string; create?: string };

export default async function AdminCategoriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const store = await getStore();
  const [categories, params] = await Promise.all([
    store.listCategories().then((rows) => rows.filter((category) => category.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE)),
    searchParams,
  ]);
  const editingCategory = categories.find((category) => category.id === params.edit) ?? null;
  const creating = params.create === '1' && !editingCategory;

  return (
    <AdminPage
      title="カテゴリー・お客様表示設定"
      lead="お客様向けシミュレーターの表示を一覧で管理します。詳細項目は編集するカテゴリーを選んだときだけ開きます。"
      actions={<Link href="/admin/ledger" className="btn-secondary btn-sm">← 商品台帳に戻る</Link>}
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <CustomerCategoryVisibilityPanel categories={categories} editingCategoryId={editingCategory?.id ?? null} />
        <section id="category-editor" className="min-w-0 scroll-mt-4 space-y-3" aria-label="カテゴリーの詳細編集">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">カテゴリーの詳細設定</h2>
              <p className="mt-1 text-xs text-muted">
                分類・注文範囲・必須条件などはここで編集します。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(editingCategory || creating) && (
                <Link href="/admin/categories" className="btn-secondary btn-sm">閉じる</Link>
              )}
              <Link href="/admin/categories?create=1#category-editor" className="btn-secondary btn-sm">
                ＋ カテゴリーを追加
              </Link>
            </div>
          </div>
          {editingCategory ? (
            <CategoryForm key={editingCategory.id + '-' + String(editingCategory.customer_visible)} category={editingCategory} />
          ) : creating ? (
            <CategoryForm key="create" category={null} />
          ) : (
            <div className="rounded-xl border border-line bg-white px-5 py-8 text-sm text-ink-soft">
              一覧から「詳細編集」を選ぶと、この場所に対象のカテゴリーだけ表示されます。
              表示・非表示の切り替えだけなら、一覧で完結します。
            </div>
          )}
        </section>
      </div>
    </AdminPage>
  );
}
