import { AdminPage, BackLink } from '@/components/admin/ui';
import { ModelForm } from '@/components/admin/forms';
import { canEditCostField, getCostRecordingAccess } from '@/lib/data/option-cost-recording';

export default async function NewModelPage() {
  // 本体価格は本部だけが登録・変更できる（v2.5 PR-C1b）。本部以外が追加する本体は 0 円
  const canEditBasePrice = canEditCostField(await getCostRecordingAccess());
  return (
    <AdminPage title="ベースコンテナを追加">
      <BackLink href="/admin/models" label="一覧へ戻る" />
      <ModelForm model={null} canEditBasePrice={canEditBasePrice} />
    </AdminPage>
  );
}
