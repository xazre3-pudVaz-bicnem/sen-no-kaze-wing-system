import { notFound } from 'next/navigation';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import {
  EstimateTemplateWorkbench,
  type EstimateTemplateWorkbenchLine,
  type EstimateTemplateWorkbenchSection,
} from '@/components/admin/estimate-template-workbench';

const SPEC_LABELS: Record<string, string> = {
  base: '本体のみ',
  hotel: 'ホテル',
  'hotel-single': 'ホテル・単身者',
  residence: '住宅・単身者',
  'water-kit': '水回りキット',
  office: '事務所・店舗',
};

const SECTION_LABELS = {
  interior_exterior: '内外装工事',
  option: 'オプション',
  sitework: '別途',
} as const;

type SectionCode = keyof typeof SECTION_LABELS;

export default async function EstimateTemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireCatalogEditor('/admin/estimate-templates');
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();
  const [models, templates, options, categories] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listEstimateTemplates(),
    store.listOptions(),
    store.listCategories(),
  ]);

  const template = templates.find((row) => row.id === id);
  if (!template) notFound();

  const bundle = await store.getEstimateTemplateBundle(template.base_model_id, template.spec_code);
  if (!bundle) notFound();

  const model = models.find((row) => row.id === template.base_model_id);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const baseSection = bundle.sections.find((section) => section.code === 'base');
  const baseTotal = baseSection?.total ?? bundle.base_breakdown_items.reduce((sum, row) => sum + row.amount, 0);

  const sections: EstimateTemplateWorkbenchSection[] = (Object.keys(SECTION_LABELS) as SectionCode[]).map((code) => {
    const section = bundle.sections.find((row) => row.code === code);
    return {
      code,
      label: SECTION_LABELS[code],
      expenseLabel: section?.expense_label ?? null,
      expenseAmount: section?.expense_amount ?? 0,
    };
  });

  const initialLines: EstimateTemplateWorkbenchLine[] = bundle.lines.map((line) => ({
    id: line.id,
    section: line.section_code,
    groupLabel: line.group_label ?? '',
    name: line.name,
    quantity: line.quantity ?? 1,
    unit: line.unit ?? '',
    saleUnitPrice: line.unit_price ?? 0,
    remark: line.remark ?? '',
    source: 'legacy',
    customerSelection: '—',
  }));

  const products = options
    .filter((option) => option.status === 'published')
    .map((option) => ({
      id: option.id,
      categoryId: option.category_id,
      categoryCode: categoryMap.get(option.category_id)?.code ?? '',
      categoryName: categoryMap.get(option.category_id)?.name ?? '未分類',
      name: option.name,
      manufacturer: option.manufacturer ?? '',
      modelNo: option.model_no ?? '',
      sizeNote: option.size_note ?? '',
      price: option.price,
      priceOnRequest: option.price_on_request,
      imageUrl: option.image_url,
    }));

  const returnSection =
    sp.return_section === 'interior_exterior' || sp.return_section === 'option' || sp.return_section === 'sitework'
      ? sp.return_section
      : undefined;

  return (
    <AdminPage
      title={template.name}
      lead={(model?.name ?? '—') + '／' + (SPEC_LABELS[template.spec_code] ?? template.spec_code)}
      actions={
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm" disabled>新しい下書き版を作る</button>
          <button type="button" className="btn-secondary btn-sm" disabled>複製して新規作成</button>
        </div>
      }
    >
      <BackLink href="/admin/estimate-templates" label="見積テンプレート一覧へ戻る" />

      <Alert tone="info">
        既存の分類表見積データを使って、新しい編集画面を確認しています。
        この画面で行った明細変更はまだDBへ保存されません。
      </Alert>

      <section className="card grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-muted">商品</p>
          <p className="mt-1 font-semibold">{model?.name ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">用途・仕様</p>
          <p className="mt-1 font-semibold">{SPEC_LABELS[template.spec_code] ?? template.spec_code}</p>
        </div>
        <div>
          <p className="text-xs text-muted">利用地域</p>
          <p className="mt-1 font-semibold">全国（移行元）</p>
        </div>
        <div>
          <p className="text-xs text-muted">状態</p>
          <p className="mt-1"><Badge tone="neutral">取込済み</Badge></p>
        </div>
        <div>
          <p className="text-xs text-muted">防火仕様</p>
          <p className="mt-1 font-semibold">未設定（旧データ）</p>
        </div>
        <div>
          <p className="text-xs text-muted">作成元</p>
          <p className="mt-1 font-semibold">本部（移行元）</p>
        </div>
        <div>
          <p className="text-xs text-muted">現在の税込金額</p>
          <p className="mt-1 font-semibold">{formatYen(template.total)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">参照本体</p>
          <p className="mt-1 font-semibold">本体マスター接続前</p>
        </div>
      </section>

      <EstimateTemplateWorkbench
        templateId={template.id}
        role={actor.role}
        baseLines={bundle.base_breakdown_items.map((line) => ({
          id: line.id,
          section: line.section,
          name: line.name,
          quantity: line.quantity,
          unit: line.unit ?? '',
          unitPrice: line.unit_price,
          amount: line.amount,
          remark: line.remark ?? '',
        }))}
        baseTotal={baseTotal}
        initialLines={initialLines}
        sections={sections}
        products={products}
        createdOptionId={sp.created_option}
        returnSection={returnSection}
        taxRate={template.tax_rate}
        adjustment={template.adjustment}
      />
    </AdminPage>
  );
}
