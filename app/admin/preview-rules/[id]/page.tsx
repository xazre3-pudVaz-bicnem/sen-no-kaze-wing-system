import { notFound } from 'next/navigation';
import { getStore } from '@/lib/data/store';
import { previewKeyLabels } from '@/lib/domain/preview';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { PreviewRuleForm } from '@/components/admin/forms';

export default async function EditPreviewRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const [models, options] = await Promise.all([store.listModels({ includeDraft: true }), store.listOptions()]);
  let rule = null;
  for (const m of models) {
    const b = await store.getCatalogBundle(m.id, { includeDraft: true });
    const found = b?.previewRules.find((r) => r.id === id);
    if (found) {
      rule = found;
      break;
    }
  }
  if (!rule) notFound();
  const keys = [...previewKeyLabels(options).entries()].map(([key, label]) => ({ key, label }));
  return (
    <AdminPage title="画像ルールを編集">
      <BackLink href="/admin/preview-rules" label="一覧へ戻る" />
      <PreviewRuleForm rule={rule} models={models} previewKeys={keys} />
    </AdminPage>
  );
}
