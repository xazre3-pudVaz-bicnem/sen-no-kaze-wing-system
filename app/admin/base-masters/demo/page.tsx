import { requireCatalogEditor } from '@/lib/auth/session';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { BaseMasterExcelDemo } from '@/components/admin/base-master-excel-demo';

export default async function BaseMasterDemoPage() {
  await requireCatalogEditor('/admin/base-masters/demo');

  return (
    <AdminPage
      title="操作確認用 本体マスター"
      lead="構成一覧・Base Master詳細・仕様マトリクスの完成イメージを確認するDB非連動サンプルです。変更内容は保存されません。"
    >
      <BackLink href="/admin/base-masters" label="本体マスター一覧へ戻る" />

      <BaseMasterExcelDemo />
    </AdminPage>
  );
}
