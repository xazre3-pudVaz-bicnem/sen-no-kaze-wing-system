import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Badge } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import {
  EstimateTemplateWorkbench,
  type EstimateTemplateWorkbenchLine,
  type EstimateTemplateWorkbenchSection,
} from '@/components/admin/estimate-template-workbench';
import { EstimateTemplateDetailTabs } from '@/components/admin/estimate-template-detail-tabs';
import { StandardEstimateSimulatorPreview } from '@/components/admin/standard-estimate-simulator-preview';
import { EstimateTemplateExcelDemo } from '@/components/admin/estimate-template-excel-demo';

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

function estimateHref(id: string) {
  const params = new URLSearchParams({ estimate: id });
  return `/admin/estimate-templates?${params.toString()}`;
}

export default async function EstimateTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireCatalogEditor('/admin/estimate-templates');
  const sp = await searchParams;
  const store = await getStore();

  const [models, templates, options, categories] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listEstimateTemplates(),
    store.listOptions(),
    store.listCategories(),
  ]);

  const selectedTemplate =
    templates.find((template) => template.id === sp.estimate) ??
    templates[0] ??
    null;

  if (!selectedTemplate) {
    return (
      <AdminPage
        title="見積書作成・管理"
        lead="見積書を開いたらすぐ、Excelに近い明細編集から作業を始めます。"
        actions={
          <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
            ＋ 新しい見積書を作成
          </Link>
        }
      >
        <Alert tone="info">
          現在は正式な見積書データが未登録のため、Excel型の操作確認画面を直接表示しています。
          この画面の変更はDBへ保存されません。
        </Alert>
        <EstimateTemplateExcelDemo />
      </AdminPage>
    );
  }

  const [bundle, catalogBundle] = await Promise.all([
    store.getEstimateTemplateBundle(selectedTemplate.base_model_id, selectedTemplate.spec_code),
    store.getCatalogBundle(selectedTemplate.base_model_id),
  ]);

  const model = models.find((row) => row.id === selectedTemplate.base_model_id) ?? null;
  const categoryMap = new Map(categories.map((category) => [category.id, category] as const));

  if (!bundle) {
    return (
      <AdminPage
        title="見積書作成・管理"
        lead="見積書をExcelに近い操作感で作成・編集します。"
        actions={
          <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
            ＋ 新しい見積書を作成
          </Link>
        }
      >
        <Alert tone="warn">選択した見積書の明細を読み込めませんでした。別の見積書を選択してください。</Alert>
        <section className="card p-4">
          <details>
            <summary className="cursor-pointer text-sm font-semibold">見積書を選ぶ</summary>
            <div className="mt-3 divide-y divide-line">
              {templates.map((template) => (
                <Link key={template.id} href={estimateHref(template.id)} className="block px-3 py-2 text-sm hover:bg-sand/40">
                  {template.name}
                </Link>
              ))}
            </div>
          </details>
        </section>
      </AdminPage>
    );
  }

  const baseSection = bundle.sections.find((section) => section.code === 'base');
  const baseTotal =
    baseSection?.total ??
    bundle.base_breakdown_items.reduce((sum, row) => sum + row.amount, 0);

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
    sp.return_section === 'interior_exterior' ||
    sp.return_section === 'option' ||
    sp.return_section === 'sitework'
      ? sp.return_section
      : undefined;

  const workspaceReturnPath = `/admin/estimate-templates?estimate=${selectedTemplate.id}`;

  const unavailablePreview = (
    <section className="card px-5 py-8 text-center">
      <p className="font-semibold">この見積書の表示データを準備中です</p>
      <p className="mt-1 text-sm text-muted">編集画面は利用できます。見積書・プランボード表示は正式接続後に確認できます。</p>
    </section>
  );

  return (
    <AdminPage
      title="見積書作成・管理"
      lead="開いたらすぐ明細を編集できる、Excelに近い見積書作成画面です。"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
            ＋ 新しい見積書を作成
          </Link>
          <button type="button" className="btn-secondary btn-sm" disabled title="正式な複製保存の接続後に利用できます">
            複製
          </button>
          <button type="button" className="btn-secondary btn-sm" disabled title="標準指定の正式接続後に利用できます">
            標準に設定
          </button>
        </div>
      }
    >
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-muted">編集中の見積書</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{selectedTemplate.name}</h2>
              <Badge tone="neutral">編集画面</Badge>
            </div>
          </div>

          <details className="relative">
            <summary className="btn-secondary btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              見積書を選ぶ
            </summary>
            <div className="absolute right-0 z-40 mt-2 max-h-[24rem] w-[22rem] overflow-y-auto rounded-xl border border-line bg-white p-2 shadow-xl">
              <p className="px-2 pb-2 pt-1 text-[11px] font-semibold text-muted">作成済み見積書</p>
              <div className="divide-y divide-line">
                {templates.map((template) => {
                  const active = template.id === selectedTemplate.id;
                  const templateModel = models.find((item) => item.id === template.base_model_id);
                  return (
                    <Link
                      key={template.id}
                      href={estimateHref(template.id)}
                      aria-current={active ? 'page' : undefined}
                      className={
                        active
                          ? 'block rounded-lg bg-forest/5 px-3 py-2 text-sm'
                          : 'block rounded-lg px-3 py-2 text-sm hover:bg-sand/40'
                      }
                    >
                      <span className="block font-semibold">{template.name}</span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {templateModel?.name ?? '—'} ／ {SPEC_LABELS[template.spec_code] ?? template.spec_code} ／ {formatYen(template.total)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </details>
        </div>

        <div className="flex flex-wrap divide-x divide-line text-xs">
          <span className="px-4 py-2">商品 <strong className="ml-1">{model?.name ?? '—'}</strong></span>
          <span className="px-4 py-2">仕様 <strong className="ml-1">{SPEC_LABELS[selectedTemplate.spec_code] ?? selectedTemplate.spec_code}</strong></span>
          <span className="px-4 py-2">現在額 <strong className="ml-1">{formatYen(selectedTemplate.total)}</strong></span>
        </div>
      </section>

      <Alert tone="info">
        現在はExcel型編集画面をメイン画面として確認する段階です。画面内の明細変更はまだDBへ保存されません。
      </Alert>

      <EstimateTemplateDetailTabs
        editContent={
          <EstimateTemplateWorkbench
            templateId={selectedTemplate.id}
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
            returnPath={workspaceReturnPath}
            taxRate={selectedTemplate.tax_rate}
            adjustment={selectedTemplate.adjustment}
          />
        }
        estimateContent={
          catalogBundle ? (
            <StandardEstimateSimulatorPreview
              bundle={catalogBundle}
              specCode={selectedTemplate.spec_code}
              template={bundle}
              initialContentTab="estimate"
              showContentTabs={false}
              showEditLink={false}
              previewOnly
            />
          ) : unavailablePreview
        }
        planContent={
          catalogBundle ? (
            <StandardEstimateSimulatorPreview
              bundle={catalogBundle}
              specCode={selectedTemplate.spec_code}
              template={bundle}
              initialContentTab="plan"
              showContentTabs={false}
              showEditLink={false}
              previewOnly
            />
          ) : unavailablePreview
        }
      />
    </AdminPage>
  );
}
