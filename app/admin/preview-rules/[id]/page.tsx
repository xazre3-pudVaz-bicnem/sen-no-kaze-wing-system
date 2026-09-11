import { notFound } from 'next/navigation';
import { getStore } from '@/lib/data/store';
import { previewKeyLabels } from '@/lib/domain/preview';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { PreviewRuleForm } from '@/components/admin/forms';

export default async function EditPreviewRulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ model?: string; section?: string; back?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
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
  const fallbackBack = `/admin/preview-rules?model=${sp.model ?? rule.base_model_id}&section=${sp.section ?? (rule.view === 'floorplan' ? 'floorplan' : 'completion')}`;
  const back = sp.back?.startsWith('/admin/models/') || sp.back?.startsWith('/admin/preview-rules') ? sp.back : fallbackBack;
  return (
    <AdminPage title="シミュレーター画像を変更">
      <BackLink href={back} label="画像管理へ戻る" />
      <PreviewRuleForm rule={rule} models={models} previewKeys={keys} />
    </AdminPage>
  );
}
