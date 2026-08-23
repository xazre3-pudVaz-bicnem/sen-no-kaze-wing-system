import { getStore } from '@/lib/data/store';
import { AdminPage } from '@/components/admin/ui';
import { CategoryForm } from '@/components/admin/forms';

export default async function AdminCategoriesPage() {
  const store = await getStore();
  const categories = await store.listCategories();
  return (
    <AdminPage title="オプションカテゴリー" lead="商品台帳の分類フォルダ・カテゴリー・選択方式・注文範囲を管理します。各行がそのまま編集フォームです。">
      <div className="space-y-4">
        {categories.map((c) => (
          <CategoryForm key={c.id} category={c} />
        ))}
      </div>
      <section>
        <h2 className="mb-3 text-lg">カテゴリーを追加</h2>
        <CategoryForm category={null} />
      </section>
    </AdminPage>
  );
}
