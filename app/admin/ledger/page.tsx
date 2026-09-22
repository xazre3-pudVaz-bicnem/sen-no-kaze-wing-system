import Link from 'next/link';
import { ProductLedgerClient } from '@/components/admin/product-ledger-client';
import { AdminPage, FlashMessages } from '@/components/admin/ui';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { canEditCatalog } from '@/lib/domain/types';

export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();
  const [options, categories] = await Promise.all([store.listOptions(), store.listCategories()]);
  const rows = await Promise.all(options.map(async (option) => [option.id, await store.getOptionVariants(option.id)] as const));
  const selected = typeof sp.product === 'string' && options.some((option) => option.id === sp.product) ? sp.product : undefined;
  const editor = canEditCatalog(actor.role);
  return <AdminPage title="商品台帳" lead="商品を探して内容を確認し、必要なときだけ編集します。お客様への表示はシミュレーターと共通です。" actions={<>{editor && <Link href="/admin/import" className="btn-secondary btn-sm">一括登録</Link>}{editor && <Link href="/admin/categories" className="btn-secondary btn-sm">分類・カテゴリー</Link>}{editor && <Link href="/admin/options/new" className="btn-primary btn-sm">商品を追加</Link>}</>}>
    <FlashMessages sp={sp} />
    <ProductLedgerClient canEdit={editor} categories={categories} options={options} variantsByOptionId={Object.fromEntries(rows)} initiallySelectedId={selected} />
  </AdminPage>;
}
