import { getStore } from '@/lib/data/store';
import { previewKeyLabels } from '@/lib/domain/preview';
import { estimateTemplatesFor } from '@/lib/domain/estimate-template';
import { BASE_FLOORPLAN_NOTE } from '@/lib/domain/preview-rule-meta';
import { VIEW_KEYS, type ViewKey } from '@/lib/domain/types';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { PreviewRuleForm } from '@/components/admin/forms';

export default async function NewPreviewRulePage({ searchParams }: { searchParams: Promise<{ model?: string; view?: string; keys?: string; slot?: string; section?: string; preset?: string; back?: string }> }) {
  const sp = await searchParams;
  const store = await getStore();
  const [models, options] = await Promise.all([store.listModels({ includeDraft: true }), store.listOptions()]);
  const keys = [...previewKeyLabels(options).entries()].map(([key, label]) => ({ key, label }));
  const view = VIEW_KEYS.includes(sp.view as ViewKey) ? (sp.view as ViewKey) : undefined;
  const selectedModel = models.find((model) => model.id === sp.model);
  const isBaseFloorplan = sp.slot === 'base' && view === 'floorplan';
  const selectedEstimate = selectedModel
    ? estimateTemplatesFor(selectedModel).find((choice) => choice.code === sp.preset)
    : undefined;
  const requestedKeys = sp.keys ? sp.keys.split(',').filter(Boolean) : [];
  const presetCode = view === 'floorplan' && selectedEstimate && requestedKeys.length === 0 ? selectedEstimate.code : undefined;
  const fallbackBack = `/admin/preview-rules?model=${sp.model ?? models[0]?.id ?? ''}&section=${sp.section ?? (view === 'floorplan' ? 'floorplan' : 'completion')}`;
  const back = sp.back?.startsWith('/admin/models/') || sp.back?.startsWith('/admin/preview-rules') ? sp.back : fallbackBack;
  return (
    <AdminPage title="シミュレーター画像を追加">
      <BackLink href={back} label="画像管理へ戻る" />
      <PreviewRuleForm
        rule={null}
        models={models}
        previewKeys={keys}
        defaults={{
          base_model_id: sp.model,
          view,
          keys: requestedKeys,
          alt: isBaseFloorplan && selectedModel
            ? `${selectedModel.name} 本体平面図`
            : selectedModel && selectedEstimate
              ? `${selectedModel.name} ${selectedEstimate.name} 平面図`
              : undefined,
          internalNote: isBaseFloorplan ? BASE_FLOORPLAN_NOTE : undefined,
          presetCode,
        }}
      />
    </AdminPage>
  );
}
