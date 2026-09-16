import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { NewEstimateTemplateForm } from '@/components/admin/new-estimate-template-form';

export default async function NewEstimateTemplatePage() {
  await requireCatalogEditor('/admin/estimate-templates/new');
  const store = await getStore();
  const models = await store.listModels({ includeDraft: true });

  return (
    <AdminPage
      title="見積テンプレートを新規作成"
      lead="商品・仕様・防火区分・参照本体・利用地域を決めて、下書き版を作成します。"
    >
      <BackLink href="/admin/estimate-templates" label="見積テンプレート一覧へ戻る" />

      <NewEstimateTemplateForm
        models={models.map((model) => ({
          id: model.id,
          name: model.name,
          specs: model.presets.map((preset) => ({ code: preset.code, name: preset.name })),
        }))}
      />
    </AdminPage>
  );
}
