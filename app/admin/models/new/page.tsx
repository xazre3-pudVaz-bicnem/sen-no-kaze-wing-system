import { AdminPage, BackLink } from '@/components/admin/ui';
import { ModelForm } from '@/components/admin/forms';

export default function NewModelPage() {
  return (
    <AdminPage title="ベースコンテナを追加">
      <BackLink href="/admin/models" label="一覧へ戻る" />
      <ModelForm model={null} />
    </AdminPage>
  );
}
