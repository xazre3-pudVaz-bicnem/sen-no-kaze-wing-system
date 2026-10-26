import { getStore } from '@/lib/data/store';
import { AdminPage } from '@/components/admin/ui';
import { CategoryForm } from '@/components/admin/forms';
import { CustomerCategoryVisibilityPanel } from '@/components/admin/customer-category-visibility-panel';
import { LEGACY_FIRE_SPEC_CATEGORY_CODE } from '@/lib/domain/types';

export default async function AdminCategoriesPage() {
  const store = await getStore();
  const categories = (await store.listCategories()).filter((category) => category.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE);
  return (
    <AdminPage title="オプションカテゴリー" lead="商品台帳の分類フォルダ・カテゴリー・選択方式・注文範囲を管理します。防火仕様は商品カテゴリーではなく、標準見積・本体仕様の条件として管理します。">
      <CustomerCategoryVisibilityPanel categories={categories} />
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">カテゴリーの詳細設定</h2>
        <p className="text-sm text-muted">カテゴリー名・選択方式・注文範囲などは、従来どおり下の編集フォームから変更できます。</p>
        {categories.map((c) => (
          <CategoryForm key={c.id} category={c} />
        ))}
      </section>
      <section>
        <h2 className="mb-3 text-lg">カテゴリーを追加</h2>
        <CategoryForm category={null} />
      </section>
    </AdminPage>
  );
}
