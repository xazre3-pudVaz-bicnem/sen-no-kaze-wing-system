import { getStore } from '@/lib/data/store';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { OptionForm } from '@/components/admin/forms';

export default async function NewOptionPage() {
  const store = await getStore();
  const [categories, models, options] = await Promise.all([store.listCategories(), store.listModels({ includeDraft: true }), store.listOptions()]);
  return (
    <AdminPage title="オプションを追加">
      <BackLink href="/admin/options" label="一覧へ戻る" />
      <OptionForm option={null} categories={categories} models={models} allOptions={options} dependencies={[]} conflicts={[]} />
    </AdminPage>
  );
}
