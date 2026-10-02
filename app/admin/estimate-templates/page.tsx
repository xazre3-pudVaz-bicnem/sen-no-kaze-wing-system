import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { Alert } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import {
  EstimateTemplateWorkbench,
  type EstimateTemplateWorkbenchLine,
  type EstimateTemplateWorkbenchSection,
} from '@/components/admin/estimate-template-workbench';
import { EstimateTemplateDetailTabs } from '@/components/admin/estimate-template-detail-tabs';
import { StandardEstimateSimulatorPreview } from '@/components/admin/standard-estimate-simulator-preview';
import {
  EstimateTemplateExcelDemo,
  type EstimateTemplateExcelDemoProduct,
} from '@/components/admin/estimate-template-excel-demo';
import { ESTIMATE_DEMO_SAMPLES, estimateDemoSampleById } from '@/components/admin/estimate-template-demo-samples';
import { SavedEstimateMenu } from '@/components/admin/saved-estimate-menu';
import { QuoteManagementTabs } from '@/components/admin/quote-management-tabs';

const SECTION_LABELS = {
  interior_exterior: '内外装工事',
  option: 'オプション',
  sitework: '別途',
} as const;

type SectionCode = keyof typeof SECTION_LABELS;

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
  const categoryMap = new Map(categories.map((category) => [category.id, category] as const));
  const demoProducts: EstimateTemplateExcelDemoProduct[] = options
    .filter((option) => option.status === 'published')
    .map((option) => ({
      id: option.id,
      category: categoryMap.get(option.category_id)?.name ?? '未分類',
      categoryCode: categoryMap.get(option.category_id)?.code ?? '',
      name: option.name,
      manufacturer: option.manufacturer ?? '',
      modelNo: option.model_no ?? '',
      price: option.price,
      priceOnRequest: option.price_on_request,
      imageUrl: option.image_url,
    }));

  const savedEstimateSamples = ESTIMATE_DEMO_SAMPLES.map((sample) => ({
    id: sample.id,
    name: sample.name,
    model: sample.model,
    spec: sample.spec,
    fireSpec: sample.fireSpec,
    sourceSheet: sample.sourceSheet,
    sourceTotal: sample.sourceTotal,
  }));

  const requestedSample = estimateDemoSampleById(sp.sample);
  const selectedSample =
    requestedSample ??
    (!sp.estimate && templates.length === 0 ? ESTIMATE_DEMO_SAMPLES[0] ?? null : null);
  const selectedTemplate = selectedSample
    ? null
    : templates.find((template) => template.id === sp.estimate) ??
      templates[0] ??
      null;

  if (!selectedTemplate) {
    return (
      <AdminPage
        title="見積書管理"
        actions={
          <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
            ＋ 標準見積を作成
          </Link>
        }
      >
        <QuoteManagementTabs active="standard" />
        <SavedEstimateMenu
          templates={templates}
          models={models}
          samples={savedEstimateSamples}
          selectedSampleId={selectedSample?.id}
        />
        <EstimateTemplateExcelDemo
          key={selectedSample?.id ?? 'new-estimate-demo'}
          sampleId={selectedSample?.id}
          products={demoProducts}
        />
      </AdminPage>
    );
  }

  const [bundle, catalogBundle] = await Promise.all([
    store.getEstimateTemplateBundle(selectedTemplate.base_model_id, selectedTemplate.spec_code),
    store.getCatalogBundle(selectedTemplate.base_model_id),
  ]);

  if (!bundle) {
    return (
      <AdminPage
        title="見積書管理"
        actions={
          <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
            ＋ 標準見積を作成
          </Link>
        }
      >
        <QuoteManagementTabs active="standard" />
        <SavedEstimateMenu
          templates={templates}
          models={models}
          samples={savedEstimateSamples}
          selectedId={selectedTemplate.id}
        />
        <Alert tone="warn">選択したシミュレーター標準の明細を読み込めませんでした。一覧から別の標準見積を選択してください。</Alert>
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
      <p className="font-semibold">このシミュレーター標準の表示データを準備中です</p>
      <p className="mt-1 text-sm text-muted">編集画面は利用できます。見積書・プランボード表示は正式接続後に確認できます。</p>
    </section>
  );

  return (
    <AdminPage
      title="見積書管理"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
            ＋ 標準見積を作成
          </Link>
          <button type="button" className="btn-secondary btn-sm" disabled title="正式な複製保存の接続後に利用できます">
            複製
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled
            title="シミュレーターの選択対象となる標準指定の接続後に利用できます"
          >
            シミュレーター標準に設定
          </button>
        </div>
      }
    >
      <QuoteManagementTabs active="standard" />
      <SavedEstimateMenu
        templates={templates}
        models={models}
        samples={savedEstimateSamples}
        selectedId={selectedTemplate.id}
      />
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
