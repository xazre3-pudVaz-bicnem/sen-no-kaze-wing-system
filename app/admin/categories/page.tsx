import { getStore } from '@/lib/data/store';
import { AdminPage } from '@/components/admin/ui';
import { CategoryForm } from '@/components/admin/forms';

export default async function AdminCategoriesPage() {
  const store = await getStore();
  const categories = await store.listCategories();
  return (
    <AdminPage title="オプションカテゴリー" lead="シミュレーターの左カラムに表示されるカテゴリーと選択方式を管理します。">
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
