import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { OptionForm } from '@/components/admin/forms';

export default async function NewOptionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();
  const [allCategories, models, options] = await Promise.all([
    store.listCategories(),
    store.listModels({ includeDraft: true }),
    store.listOptions(),
  ]);
  // 代理店が登録できるのはフリー商品だけ（サーバーアクション側でも拒否している）
  const catalogEditor = canEditCatalog(actor.role);
  const categories = catalogEditor ? allCategories : allCategories.filter((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const freeCategory = allCategories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const defaultCategoryId = sp.category ?? (catalogEditor ? undefined : freeCategory?.id);
  const isFree = defaultCategoryId && defaultCategoryId === freeCategory?.id;

  return (
    <AdminPage title={isFree ? 'フリー商品を追加' : 'オプションを追加'}>
      <BackLink href={isFree ? '/admin/free-products' : '/admin/options'} label="一覧へ戻る" />
      <OptionForm
        option={null}
        categories={categories}
        models={models}
        allOptions={options}
        dependencies={[]}
        conflicts={[]}
        defaultCategoryId={defaultCategoryId}
      />
    </AdminPage>
  );
}
