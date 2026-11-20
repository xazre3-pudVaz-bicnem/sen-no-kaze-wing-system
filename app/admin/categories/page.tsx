import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { hasRoleAtLeast, LEGACY_FIRE_SPEC_CATEGORY_CODE } from '@/lib/domain/types';
import { AdminPage } from '@/components/admin/ui';
import { CategoryForm } from '@/components/admin/forms';
import { CustomerCategoryVisibilityPanel } from '@/components/admin/customer-category-visibility-panel';
import { ProductSelectionSettingsTabs } from '@/components/admin/product-selection-settings-tabs';
import { SelectionMatrixPanel } from '@/components/admin/selection-matrix-panel';
import type { MatrixEditorRow } from '@/components/admin/matrix-editor';
import { Alert } from '@/components/ui';

export const metadata: Metadata = { title: '商品選択設定' };

type SearchParams = { edit?: string; create?: string; tab?: string };

export default async function AdminCategoriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireStaff('/admin/categories');
  const store = await getStore();
  const [categories, matrix, models, params] = await Promise.all([
    store.listCategories().then((items) =>
      items.filter((category) => category.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE)
    ),
    store.getSpecMatrix(),
    store.listModels({ includeDraft: actor.role === 'admin' }),
    searchParams,
  ]);

  const canEditCategories = hasRoleAtLeast(actor.role, 'master_dealer');
  const canEditMatrix = actor.role === 'admin';
  const editingCategory = canEditCategories
    ? categories.find((category) => category.id === params.edit) ?? null
    : null;
  const creating = canEditCategories && params.create === '1' && !editingCategory;
  const initialTab = (params.edit || params.create)
    ? 'categories'
    : params.tab === 'matrix' ? 'matrix' : 'categories';

  const rows: MatrixEditorRow[] = matrix?.rows.map((row) => ({
    ...row,
    model_name: models.find((model) => model.id === row.base_model_id)?.name ?? '不明な機種',
    selectable_items: matrix.cells.filter(
      (cell) => cell.matrix_row_id === row.id && cell.selectable
    ).map((cell) => cell.matrix_item_code),
  })) ?? [];

  return (
    <AdminPage
      title="商品選択設定"
      lead="機種・仕様別の選択可否と、お客様への共通表示を2つのタブで管理します。設定と保存先は従来どおり別々です。防火仕様は商品カテゴリーではなく、標準見積・本体仕様の条件として管理します。"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/base-masters" className="btn-secondary btn-sm">本体マスター</Link>
          <Link href="/admin/window-types" className="btn-secondary btn-sm">窓タイプ</Link>
          <Link href="/admin/ledger" className="btn-secondary btn-sm">← 商品台帳に戻る</Link>
        </div>
      }
    >
      <ProductSelectionSettingsTabs
        initialTab={initialTab}
        matrix={
          matrix ? (
            <div className="space-y-3">
              <Alert tone="info">
                仕様別の変更はシミュレーターの選択肢、Configuration の保存・見積依頼の検査に反映されます。
                発行済みの見積・承諾済みの内容は変更しません。
              </Alert>
              <SelectionMatrixPanel
                rows={rows}
                items={matrix.items}
                specs={matrix.specs}
                sizes={matrix.sizes}
                models={models.map((model) => ({ id: model.id, name: model.name }))}
                categories={categories}
                categoryItems={matrix.categoryItems}
                canEdit={canEditMatrix}
                actorId={actor.id}
              />
            </div>
          ) : (
            <Alert tone="warn">本体仕様マトリクスがありません（DBの更新が未適用の可能性があります）。</Alert>
          )
        }
        categories={
          <div className="space-y-5">
            <CustomerCategoryVisibilityPanel
              categories={categories}
              editingCategoryId={editingCategory?.id ?? null}
              canEdit={canEditCategories}
            />
            {canEditCategories && (
              <section id="category-editor" className="scroll-mt-4 space-y-3" aria-label="カテゴリーの詳細編集">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">カテゴリーの詳細設定</h2>
                    <p className="mt-1 text-xs text-muted">分類・注文範囲・必須条件などはこちらで編集します。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(editingCategory || creating) && (
                      <Link href="/admin/categories#category-editor" className="btn-secondary btn-sm">閉じる</Link>
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
                  <div className="rounded-xl border border-line bg-white px-5 py-6 text-sm text-ink-soft">
                    「詳細編集」から対象カテゴリーを開けます。表示・非表示だけなら上の一覧で保存できます。
                  </div>
                )}
              </section>
            )}
          </div>
        }
      />
    </AdminPage>
  );
}
