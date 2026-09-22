import Link from 'next/link';
import { ProductLedgerClient } from '@/components/admin/product-ledger-client';
import { AdminPage, FlashMessages } from '@/components/admin/ui';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';

export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();
  const [options, categories] = await Promise.all([store.listOptions(), store.listCategories()]);
  const catalogCategories = categories.filter((category) => category.code !== FREE_PRODUCT_CATEGORY_CODE);
  const catalogCategoryIds = new Set(catalogCategories.map((category) => category.id));
  const catalogOptions = options.filter((option) => catalogCategoryIds.has(option.category_id));
  const rows = await Promise.all(catalogOptions.map(async (option) => [option.id, await store.getOptionVariants(option.id)] as const));
  const selected = typeof sp.product === 'string' && catalogOptions.some((option) => option.id === sp.product) ? sp.product : undefined;
  const editor = canEditCatalog(actor.role);

  return <AdminPage
    title="商品台帳"
    lead="UB・キッチン・サッシ・外壁・床・構造用面材など、見積で使う商品を登録・管理します。見積書のどの区分へ入れるかは、見積作成時に決めます。"
    notice={<><span className="font-semibold text-ink">商品台帳：</span> 商品そのものを登録する場所です。商品を「本体用」「オプション用」などに固定せず、見積書の各区分で「手入力」または「商品台帳から選択」して使います。</>}
    actions={<>{editor && <Link href="/admin/import" className="btn-secondary btn-sm">管理用：商品一括登録</Link>}{editor && <Link href="/admin/options/new" className="btn-primary btn-sm">＋ 商品を登録</Link>}</>}
  >
    <FlashMessages sp={sp} />
    <ProductLedgerClient canEdit={editor} categories={catalogCategories} options={catalogOptions} variantsByOptionId={Object.fromEntries(rows)} initiallySelectedId={selected} />
  </AdminPage>;
}
