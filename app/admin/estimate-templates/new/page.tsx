import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { NewEstimateTemplateForm } from '@/components/admin/new-estimate-template-form';

export default async function NewEstimateTemplatePage() {
  const actor = await requireCatalogEditor('/admin/estimate-templates/new');
  const store = await getStore();
  const [models, options, categories] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listOptions(),
    store.listCategories(),
  ]);
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <AdminPage
      title="標準見積を新規作成"
      lead="商品モデル・仕様・防火仕様・適用地域を設定し、Excel形式の明細編集へ進みます。"
    >
      <BackLink href="/admin/estimate-templates" label="標準見積一覧へ戻る" />

      <NewEstimateTemplateForm
        role={actor.role}
        models={models.map((model) => ({
          id: model.id,
          name: model.name,
          specs: model.presets.map((preset) => ({ code: preset.code, name: preset.name })),
        }))}
        products={options
          .filter((option) => option.status === 'published')
          .map((option) => ({
            id: option.id,
            categoryId: option.category_id,
            categoryName: categoryMap.get(option.category_id) ?? '未分類',
            name: option.name,
            manufacturer: option.manufacturer ?? '',
            modelNo: option.model_no ?? '',
            sizeNote: option.size_note ?? '',
            price: option.price,
            priceOnRequest: option.price_on_request,
            imageUrl: option.image_url,
          }))}
      />
    </AdminPage>
  );
}
