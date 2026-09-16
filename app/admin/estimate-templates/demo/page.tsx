import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import {
  EstimateTemplateExcelDemo,
  type EstimateExcelDemoProduct,
} from '@/components/admin/estimate-template-excel-demo';

export default async function EstimateTemplateDemoPage() {
  await requireCatalogEditor('/admin/estimate-templates/demo');
  const store = await getStore();
  const [options, categories] = await Promise.all([
    store.listOptions(),
    store.listCategories(),
  ]);
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));

  const products: EstimateExcelDemoProduct[] = options
    .filter((option) => option.status === 'published')
    .map((option) => ({
      id: option.id,
      categoryId: option.category_id,
      categoryName: categoryMap.get(option.category_id) ?? '未分類',
      name: option.name,
      manufacturer: option.manufacturer ?? '',
      modelNo: option.model_no ?? '',
      sizeNote: option.size_note ?? '',
      price: option.price,
      priceOnRequest: option.price_on_request,
    }));

  return (
    <AdminPage
      title="操作確認用 Wing ホテルUB 非防火"
      lead="元Excelの計算ルールと、検討済みのExcel風操作をReact画面で確認するためのサンプルです。変更内容は保存されません。"
    >
      <BackLink href="/admin/estimate-templates" label="見積テンプレート一覧へ戻る" />

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
          <p className="mt-1"><Badge tone="neutral">操作確認用</Badge></p>
        </div>
      </section>

      <EstimateTemplateExcelDemo products={products} />
    </AdminPage>
  );
}
