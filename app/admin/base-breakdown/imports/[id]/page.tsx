import { notFound } from 'next/navigation';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { Alert } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { EstimateImportReview } from '@/components/admin/estimate-import-review';

export default async function EstimateImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireCatalogEditor();
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();
  const bundle = await store.getEstimateImportBundle(id);
  if (!bundle) notFound();

  const [model, categories, options] = await Promise.all([
    store.getModelById(bundle.import.base_model_id, { includeDraft: true }),
    store.listCategories(),
    store.listOptions(),
  ]);

  return (
    <AdminPage
      title="標準見積の商品照合"
      lead="Excel明細と商品マスターを確認し、必須商品がすべて確定したあとで標準見積を有効化します。"
    >
      <BackLink href={`/admin/base-breakdown?model=${bundle.import.base_model_id}&spec=${bundle.import.spec_code}`} label="標準見積・本体内訳へ戻る" />
      {sp.saved && <Alert tone="success">商品照合を保存しました。</Alert>}
      {sp.activated && <Alert tone="success">この標準見積を有効にしました。シミュレーターへ反映されます。</Alert>}
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      <EstimateImportReview
        bundle={bundle}
        categories={categories}
        options={options}
        modelName={model?.name ?? bundle.import.base_model_id}
      />
    </AdminPage>
  );
}
