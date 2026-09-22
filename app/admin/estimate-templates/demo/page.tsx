import { requireCatalogEditor } from '@/lib/auth/session';
import { Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { EstimateTemplateExcelDemo } from '@/components/admin/estimate-template-excel-demo';

export default async function EstimateTemplateDemoPage() {
  await requireCatalogEditor('/admin/estimate-templates/demo');

  return (
    <AdminPage
      title="操作確認用 Wing ホテルUB 非防火"
      lead="本体基準と標準見積の見た目・操作感を確認するためのDB非連動サンプルです。変更内容は保存されません。"
    >
      <BackLink href="/admin/base-masters" label="販売基準へ戻る" />

      <section className="card grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <p className="text-xs text-muted">商品</p>
          <p className="mt-1 font-semibold">Wing</p>
        </div>
        <div>
          <p className="text-xs text-muted">仕様</p>
          <p className="mt-1 font-semibold">ホテルUB</p>
        </div>
        <div>
          <p className="text-xs text-muted">防火仕様</p>
          <p className="mt-1 font-semibold">非防火</p>
        </div>
        <div>
          <p className="text-xs text-muted">基準</p>
          <p className="mt-1 font-semibold">2026-09-01修正分類表見積書</p>
        </div>
        <div>
          <p className="text-xs text-muted">状態</p>
          <p className="mt-1"><Badge tone="neutral">操作確認用・DB非連動</Badge></p>
        </div>
      </section>

      <EstimateTemplateExcelDemo />
    </AdminPage>
  );
}
