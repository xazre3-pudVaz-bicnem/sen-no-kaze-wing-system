import { getStore } from '@/lib/data/store';
import { previewKeyLabels } from '@/lib/domain/preview';
import { VIEW_KEYS, type ViewKey } from '@/lib/domain/types';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { PreviewRuleForm } from '@/components/admin/forms';

export default async function NewPreviewRulePage({ searchParams }: { searchParams: Promise<{ model?: string; view?: string; keys?: string }> }) {
  const sp = await searchParams;
  const store = await getStore();
  const [models, options] = await Promise.all([store.listModels({ includeDraft: true }), store.listOptions()]);
  const keys = [...previewKeyLabels(options).entries()].map(([key, label]) => ({ key, label }));
  const view = VIEW_KEYS.includes(sp.view as ViewKey) ? (sp.view as ViewKey) : undefined;
  return (
    <AdminPage title="画像ルールを追加">
      <BackLink href="/admin/preview-rules" label="一覧へ戻る" />
      <PreviewRuleForm rule={null} models={models} previewKeys={keys} defaults={{ base_model_id: sp.model, view, keys: sp.keys ? sp.keys.split(',').filter(Boolean) : [] }} />
    </AdminPage>
  );
}
