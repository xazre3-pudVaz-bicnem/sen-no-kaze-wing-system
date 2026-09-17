import { requireCatalogEditor } from '@/lib/auth/session';
import { Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { BaseMasterExcelDemo } from '@/components/admin/base-master-excel-demo';

export default async function BaseMasterDemoPage() {
  await requireCatalogEditor('/admin/base-masters/demo');

  return (
    <AdminPage
      title="操作確認用 本体マスター"
      lead="本体マスターと見積テンプレートの見た目・操作感を揃えるためのDB非連動サンプルです。変更内容は保存されません。"
    >
      <BackLink href="/admin/base-masters" label="本体マスター一覧へ戻る" />

      <section className="card grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <p className="text-xs text-muted">商品</p>
          <p className="mt-1 font-semibold">Wing</p>
        </div>
        <div>
          <p className="text-xs text-muted">仕様</p>
          <p className="mt-1 font-semibold">ホテル</p>
        </div>
        <div>
          <p className="text-xs text-muted">防火仕様</p>
          <p className="mt-1 font-semibold">非防火</p>
        </div>
        <div>
          <p className="text-xs text-muted">所有</p>
          <p className="mt-1 font-semibold">本部</p>
        </div>
        <div>
          <p className="text-xs text-muted">状態</p>
          <p className="mt-1"><Badge tone="neutral">操作確認用・DB非連動</Badge></p>
        </div>
      </section>

      <BaseMasterExcelDemo />
    </AdminPage>
  );
}
